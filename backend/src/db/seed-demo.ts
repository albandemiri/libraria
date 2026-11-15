import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { activeProvider } from '../commerce/providers';
import { createCheckout } from '../commerce/service';
import { processCover } from '../covers/process-cover';
import { activateAsset, ingestNow } from '../drm/asset-ingestion.service';
import { objectStorage } from '../drm/object-storage';
import { replaceCover } from '../routes/covers-publisher';
import { applySandboxEvent } from '../routes/sandbox';
import { buildSampleEpub } from '../utils/epub';
import {
  buildDemoPlan,
  coverLabel,
  DEMO_PASSWORD,
  DEMO_SEED,
  type DemoBook,
  type DemoOrder,
  type DemoPlan,
} from './demo-data';
import { renderCover } from './demo-cover';
import {
  assertDemoSeedAllowed,
  classifyDemoState,
  DEMO_RESET_COMMAND,
  demoStateMessage,
} from './demo-guard';
import { pool, withTransaction } from './pool';

/**
 * `npm run seed:demo`: a convincing, invented Albanian marketplace for showing the portal.
 *
 * Books, covers, purchases and refunds all go through the real asset, cover and commerce
 * code (the simulated payment provider plays the provider's part), so ledger snapshots,
 * VAT, fees, commission and entitlements are correct by construction. Only the timestamps
 * are set afterwards, to spread six months of sales over the period.
 *
 * Local development only: refuses to run in production, and stops (changing nothing) if
 * the demo is already loaded.
 */

const INGEST_WAIT_MS = 120_000;
const RESET_HINT = DEMO_RESET_COMMAND;
const DEMO_MARKER_ACTION = 'demo.loaded';

const log = (message: string) => console.log(message);

async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return (rowCount ?? 0) > 0;
}

async function detectDemoState(plan: DemoPlan) {
  const count = async (table: string, ids: string[]) =>
    (await pool.query(`SELECT 1 FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])).rowCount ?? 0;
  const marker = await pool.query(
    'SELECT 1 FROM audit_events WHERE action = $1 AND resource_id = $2',
    [DEMO_MARKER_ACTION, `seed-${plan.seed}`],
  );
  return classifyDemoState({
    publishers: await count(
      'publishers',
      plan.publishers.map((p) => p.id),
    ),
    readers: await count(
      'users',
      plan.readers.map((r) => r.id),
    ),
    books: await count(
      'books',
      plan.books.map((b) => b.id),
    ),
    marker: (marker.rowCount ?? 0) > 0,
  });
}

async function ensureAdmin(passwordHash: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ('admin@libraria.example', $1, 'System Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [passwordHash],
  );
  return rows[0].id;
}

/** Publishers, their contract rates and logins, and the readers. */
async function insertPeople(plan: DemoPlan, passwordHash: string, adminId: string) {
  const hasCountry = await tableHasColumn('publishers', 'country');
  await withTransaction(async (client) => {
    for (const publisher of plan.publishers) {
      // The country column arrives with the admin console migration; use it once it exists.
      await client.query(
        hasCountry
          ? `INSERT INTO publishers (id, name, contact_email, created_at, updated_at, country)
             VALUES ($1, $2, $3, $4, $4, $5)`
          : `INSERT INTO publishers (id, name, contact_email, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $4)`,
        hasCountry
          ? [
              publisher.id,
              publisher.name,
              publisher.contactEmail,
              publisher.createdAt,
              publisher.country,
            ]
          : [publisher.id, publisher.name, publisher.contactEmail, publisher.createdAt],
      );

      // The same row the admin rate route writes: the current contract, and one scheduled.
      await client.query(
        `INSERT INTO publisher_commission_rates
           (publisher_id, rate_bps, effective_from, contract_reference, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $3)`,
        [
          publisher.id,
          publisher.rate.rateBps,
          publisher.rate.effectiveFrom,
          publisher.rate.contractReference,
          adminId,
        ],
      );
      if (publisher.futureRate) {
        await client.query(
          `INSERT INTO publisher_commission_rates
             (publisher_id, rate_bps, effective_from, contract_reference, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            publisher.id,
            publisher.futureRate.rateBps,
            publisher.futureRate.effectiveFrom,
            publisher.futureRate.contractReference,
            adminId,
            new Date(plan.now.getTime() - 7 * 24 * 60 * 60 * 1000),
          ],
        );
      }

      await client.query(
        `INSERT INTO users (email, password_hash, display_name, role, publisher_id, created_at, updated_at)
         VALUES ($1, $2, $3, 'publisher', $4, $5, $5)`,
        [
          publisher.loginEmail,
          passwordHash,
          publisher.loginName,
          publisher.id,
          new Date(publisher.createdAt.getTime() + 24 * 60 * 60 * 1000),
        ],
      );
    }

    for (const reader of plan.readers) {
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'reader', $5, $5)`,
        [reader.id, reader.email, passwordHash, reader.displayName, reader.createdAt],
      );
    }
  });
}

async function publisherLoginId(client: Pick<PoolClient, 'query'>, email: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
    email,
  ]);
  return rows[0].id;
}

/** One book: the row, its EPUB through the real pipeline, its cover, and its status. */
async function createBook(book: DemoBook, uploaderId: string): Promise<void> {
  await pool.query(
    `INSERT INTO books (
       id, publisher_id, title, author, isbn13, description, genre, language,
       price_cents, currency, media_type, is_available, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'EUR', 'ebook', FALSE, $10, $10)`,
    [
      book.id,
      book.publisherId,
      book.title,
      book.author,
      book.isbn13,
      book.description,
      book.genre,
      book.language,
      book.priceCents,
      book.createdAt,
    ],
  );

  if (book.status === 'rejected') {
    const refused = await ingestNow(book.id, uploaderId, Buffer.from('This is not an EPUB file.'), {
      waitMs: INGEST_WAIT_MS,
    });
    if (refused.state !== 'rejected') {
      throw new Error(`Expected "${book.title}" to be rejected, got ${refused.state}`);
    }
  } else if (book.status !== 'draft') {
    const asset = await ingestNow(
      book.id,
      uploaderId,
      buildSampleEpub({
        id: book.id,
        title: book.title,
        author: book.author,
        chapters: book.chapters,
      }),
      { waitMs: INGEST_WAIT_MS },
    );
    if (asset.state !== 'ready') {
      throw new Error(`"${book.title}" was not ingested (${asset.state}: ${asset.reason_code})`);
    }
    await activateAsset(book.id, asset.id, uploaderId);
  }

  if (book.withCover) {
    // The same checks, keys and write as a publisher's cover upload.
    const processed = await processCover(
      await renderCover({
        title: book.title,
        author: book.author,
        label: coverLabel(book.genre, book.language),
        ...book.cover,
      }),
    );
    const id = randomUUID();
    const objectKey = `covers/${book.id}/u-${id}.jpg`;
    const thumbKey = `covers/${book.id}/u-${id}-thumb.jpg`;
    await objectStorage().put(objectKey, processed.main);
    await objectStorage().put(thumbKey, processed.thumb);
    await replaceCover(book.id, book.publisherId, { objectKey, thumbKey });
  }

  if (book.publishedAt) {
    // What the publish route does; archived books were on sale until their archive date.
    // published_at is a DATE column: pass a plain YYYY-MM-DD string.
    await pool.query(`UPDATE books SET is_available = TRUE, published_at = $2 WHERE id = $1`, [
      book.id,
      book.publishedAt.toISOString().slice(0, 10),
    ]);
  }
}

interface PlacedOrder {
  order: DemoOrder;
  transactionId: string;
}

/** One purchase (and its refund) through the real checkout and the simulated provider. */
async function placeOrder(order: DemoOrder): Promise<PlacedOrder> {
  const provider = activeProvider();
  if (provider?.name !== 'simulated') {
    throw new Error('seed:demo needs PAYMENTS_MODE=simulated');
  }
  const { transactionId } = await createCheckout(provider, {
    userId: order.readerId,
    bookIds: order.bookIds,
    idempotencyKey: `demo-order-${order.index}`,
  });
  const { rows } = await pool.query<{ provider_transaction_id: string }>(
    'SELECT provider_transaction_id FROM transactions WHERE id = $1',
    [transactionId],
  );
  const providerTransactionId = rows[0].provider_transaction_id;

  const paid = await applySandboxEvent(
    provider,
    transactionId,
    providerTransactionId,
    { kind: 'payment_succeeded', countryCode: order.countryCode },
    order.paidAt,
  );
  if (paid.outcome !== 'applied') {
    throw new Error(`Order ${order.index} was not paid: ${paid.detail}`);
  }

  if (order.refund) {
    const refunded = await applySandboxEvent(
      provider,
      transactionId,
      providerTransactionId,
      order.refund.kind === 'partial'
        ? { kind: 'refund', partialAmountCents: order.refund.amountCents }
        : { kind: 'refund' },
      order.refund.at,
    );
    if (refunded.outcome !== 'applied') {
      throw new Error(`Order ${order.index} was not refunded: ${refunded.detail}`);
    }
  }
  return { order, transactionId };
}

/**
 * Spreads the finished data over the period. The real paths stamp "now"; here every
 * related timestamp is moved together: the transaction, its items, entitlements, library
 * entries, adjustments and payment events by order, and the books and their assets by
 * book. One transaction, with the updated_at triggers off so it can set updated_at too.
 */
async function backdate(plan: DemoPlan, placed: PlacedOrder[]): Promise<void> {
  const bookIds = plan.books.map((book) => book.id);
  await withTransaction(async (client) => {
    for (const table of ['transactions', 'user_libraries', 'books', 'book_assets', 'asset_jobs']) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    }

    const ids = placed.map((p) => p.transactionId);
    const created = placed.map((p) => p.order.createdAt);
    const paid = placed.map((p) => p.order.paidAt);
    const refundAt = placed.map((p) => p.order.refund?.at ?? null);
    const updated = placed.map((p) => p.order.refund?.at ?? p.order.paidAt);
    const orderRows = `unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[], $4::timestamptz[], $5::timestamptz[])
         AS x(id, created_at, paid_at, refund_at, updated_at)`;
    const args = [ids, created, paid, refundAt, updated];

    await client.query(
      `UPDATE transactions t
          SET created_at = x.created_at, paid_at = x.paid_at, updated_at = x.updated_at
         FROM ${orderRows}
        WHERE t.id = x.id`,
      args,
    );
    await client.query(
      `UPDATE transaction_items ti
          SET created_at = x.created_at,
              refunded_at = CASE WHEN ti.refunded_at IS NOT NULL THEN x.refund_at END
         FROM ${orderRows}
        WHERE ti.transaction_id = x.id`,
      args,
    );
    await client.query(
      `UPDATE transaction_adjustments ta SET created_at = x.refund_at
         FROM ${orderRows}
        WHERE ta.transaction_id = x.id AND x.refund_at IS NOT NULL`,
      args,
    );
    await client.query(
      `UPDATE payment_events pe
          SET occurred_at = CASE WHEN pe.event_type = 'simulated.refund' THEN x.refund_at ELSE x.paid_at END,
              received_at = CASE WHEN pe.event_type = 'simulated.refund' THEN x.refund_at ELSE x.paid_at END
         FROM ${orderRows}
        WHERE pe.transaction_id = x.id`,
      args,
    );
    await client.query(
      `UPDATE entitlements e
          SET granted_at = x.paid_at,
              revoked_at = CASE WHEN e.revoked_at IS NOT NULL THEN x.refund_at END
         FROM transaction_items ti, ${orderRows}
        WHERE e.source_item_id = ti.id AND ti.transaction_id = x.id`,
      args,
    );
    await client.query(
      `UPDATE user_libraries ul SET acquired_at = x.paid_at, updated_at = x.paid_at
         FROM ${orderRows}
        WHERE ul.transaction_id = x.id`,
      args,
    );

    // Books and their assets, a few minutes after the book was created.
    await client.query(
      `UPDATE book_assets ba
          SET created_at = b.created_at + interval '1 hour',
              updated_at = b.created_at + interval '2 hours',
              ready_at = CASE WHEN ba.ready_at IS NOT NULL THEN b.created_at + interval '90 minutes' END,
              activated_at = CASE WHEN ba.activated_at IS NOT NULL THEN b.created_at + interval '2 hours' END
         FROM books b
        WHERE ba.book_id = b.id AND b.id = ANY($1::uuid[])`,
      [bookIds],
    );
    await client.query(
      `UPDATE asset_jobs j
          SET created_at = ba.created_at, updated_at = ba.updated_at
         FROM book_assets ba
        WHERE j.asset_id = ba.id AND ba.book_id = ANY($1::uuid[])`,
      [bookIds],
    );
    await client.query(
      `UPDATE audit_events a SET created_at = ba.updated_at
         FROM book_assets ba
        WHERE a.resource_id = ba.id::text AND ba.book_id = ANY($1::uuid[])`,
      [bookIds],
    );
    await client.query(
      `UPDATE books
          SET updated_at = COALESCE(archived_at, published_at::timestamptz + interval '6 hours',
                                    created_at + interval '2 hours')
        WHERE id = ANY($1::uuid[])`,
      [bookIds],
    );

    for (const table of ['transactions', 'user_libraries', 'books', 'book_assets', 'asset_jobs']) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    }
  });
}

export async function runSeedDemo(): Promise<void> {
  assertDemoSeedAllowed(env);

  const plan = buildDemoPlan(DEMO_SEED);
  const state = await detectDemoState(plan);
  if (state !== 'absent') {
    log(demoStateMessage(state));
    if (state === 'partial') process.exitCode = 1;
    return;
  }

  log('--- Loading the Libraria demo marketplace ---');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.BCRYPT_ROUNDS);
  const adminId = await ensureAdmin(passwordHash);
  await insertPeople(plan, passwordHash, adminId);
  log(`✓ ${plan.publishers.length} publishers with contract rates, ${plan.readers.length} readers`);

  const uploaders = new Map<string, string>();
  for (const publisher of plan.publishers) {
    uploaders.set(publisher.id, await publisherLoginId(pool, publisher.loginEmail));
  }
  for (const publisher of plan.publishers) {
    const books = plan.books.filter((book) => book.publisherId === publisher.id);
    for (const book of books) {
      await createBook(book, uploaders.get(publisher.id) as string);
    }
    log(`✓ ${publisher.name}: ${books.length} books`);
  }

  const placed: PlacedOrder[] = [];
  for (const order of plan.orders) {
    placed.push(await placeOrder(order));
    if (placed.length % 100 === 0) log(`  ${placed.length}/${plan.orders.length} orders`);
  }
  const refunds = plan.orders.filter((order) => order.refund);
  log(
    `✓ ${plan.orders.length} orders through the simulated provider, ` +
      `${refunds.length} refunded (${refunds.filter((o) => o.refund?.kind === 'partial').length} partial)`,
  );

  // Archived books were on sale until the archive date: archive them last, as the route does.
  for (const book of plan.books.filter((b) => b.archivedAt)) {
    await pool.query(
      `UPDATE books SET archived_at = $2, is_available = FALSE WHERE id = $1 AND archived_at IS NULL`,
      [book.id, book.archivedAt],
    );
  }

  await backdate(plan, placed);
  log('✓ Timestamps spread over the last 6 months');

  // The very last step: only a finished load carries the marker.
  await pool.query(
    `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, 'demo', $3, $4)`,
    [
      adminId,
      DEMO_MARKER_ACTION,
      `seed-${plan.seed}`,
      JSON.stringify({ orders: plan.orders.length }),
    ],
  );

  log('');
  log('Logins (password for all: Password123!)');
  log('  admin       admin@libraria.example');
  for (const publisher of plan.publishers) {
    log(`  publisher   ${publisher.loginEmail}   (${publisher.name})`);
  }
  log(`  reader      ${plan.readers[0]?.email}   (and ${plan.readers.length - 1} more)`);
  log('--- Demo data loaded ---');
}

if (require.main === module || process.argv[1]?.endsWith('seed-demo.ts')) {
  runSeedDemo()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Demo seeding failed:', err);
      console.error(`If it stopped part-way, reset the database and run it again: ${RESET_HINT}`);
      await pool.end();
      process.exit(1);
    });
}
