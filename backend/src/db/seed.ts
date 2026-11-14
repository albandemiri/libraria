import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { activateAsset, ingestNow } from '../drm/asset-ingestion.service';
import { currentReadyAsset } from '../drm/asset-repository';
import { buildSampleEpub } from '../utils/epub';
import { pool } from './pool';

const SEED_INGEST_WAIT_MS = 120_000;

interface SeedBook {
  id: string;
  title: string;
  author: string;
  genre: string;
  isbn13: string;
  description: string;
  priceCents: number;
  chapters: Array<{ title: string; paragraphs: string[] }>;
}

const sampleBooks: SeedBook[] = [
  {
    id: 'a1111111-1111-4111-8111-111111111111',
    title: 'The Clockwork Forest',
    author: 'Evelyn Vance',
    genre: 'Science Fiction',
    isbn13: '9781234567890',
    description:
      'An expedition into a biomechanical canopy where artificial life thrives in secrecy.',
    priceCents: 499,
    chapters: [
      {
        title: 'Chapter 1: The Copper Canopy',
        paragraphs: [
          'The forest did not hum with the rustle of leaves, but with the quiet whirr of brass gears.',
          'Elena shielded her eyes from the reflected dawn glinting across the mechanical foliage.',
          'Every step forward marked a boundary between the natural world she had left behind and the intricate realm ahead.',
        ],
      },
      {
        title: 'Chapter 2: Signals in the Mist',
        paragraphs: [
          'A series of resonant clicks echoed across the ravine as dusk settled.',
          'She drew her field journal and recorded the frequency of the harmonic chimes.',
        ],
      },
    ],
  },
  {
    id: 'b2222222-2222-4222-8222-222222222222',
    title: 'Echoes of the Deep',
    author: 'Marcus Sterling',
    genre: 'Mystery',
    isbn13: '9782345678901',
    description: 'An acoustic cartographer discovers anomalies in deep-ocean sound recordings.',
    priceCents: 599,
    chapters: [
      {
        title: 'Chapter 1: Below the Continental Shelf',
        paragraphs: [
          'Hydrophone array seven had been silent for six weeks before the anomaly registered.',
          'Marcus adjusted the bandpass filters, isolating a repeating rhythmic pattern from the abyss.',
        ],
      },
    ],
  },
  {
    id: 'c3333333-3333-4333-8333-333333333333',
    title: 'Principles of Stellar Navigation',
    author: 'Dr. Aris Thorne',
    genre: 'Educational',
    isbn13: '9783456789012',
    description: 'A comprehensive guide to celestial positioning and relativistic pathfinding.',
    priceCents: 899,
    chapters: [
      {
        title: 'Chapter 1: Baseline Coordinates',
        paragraphs: [
          'Accurate interstellar navigation demands reference markers that remain stable over centuries.',
          'Pulsars provide the fundamental cosmic clockwork required for synchronized orbital burns.',
        ],
      },
    ],
  },
];

export async function runSeed(): Promise<void> {
  console.log('--- Starting Libraria Database Seeder ---');

  const passwordHash = await bcrypt.hash('Password123!', env.BCRYPT_ROUNDS);

  // 1. Create Publishers
  // The table has no unique key on the email, so look first: ON CONFLICT would
  // never fire and every run would add another house.
  const existingPublisher = await pool.query<{ id: string }>(
    `SELECT id FROM publishers
      WHERE contact_email = 'contact@apexpublishing.example'
      ORDER BY created_at LIMIT 1`,
  );
  const publisherId =
    existingPublisher.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `INSERT INTO publishers (name, contact_email)
         VALUES ('Apex Publishing House', 'contact@apexpublishing.example')
         RETURNING id`,
      )
    ).rows[0].id;

  // A contract rate, so the demo books can be sold (20% of net, from 2020).
  await pool.query(
    `INSERT INTO publisher_commission_rates (publisher_id, rate_bps, effective_from, contract_reference)
     VALUES ($1, 2000, '2020-01-01T00:00:00Z', 'Demo contract')
     ON CONFLICT (publisher_id, effective_from) DO NOTHING`,
    [publisherId],
  );

  console.log(`✓ Seeded publisher: Apex Publishing House (${publisherId}), 20% commission`);

  // 2. Create Users
  // Admin
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ('admin@libraria.example', $1, 'System Admin', 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [passwordHash],
  );

  // Publisher editor
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name, role, publisher_id)
     VALUES ('editor@apexpublishing.example', $1, 'Apex Editor', 'publisher', $2)
     ON CONFLICT (email) DO NOTHING`,
    [passwordHash, publisherId],
  );

  // Reader
  const readerResult = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, role)
     VALUES ('reader@libraria.example', $1, 'Jane Reader', 'reader')
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [passwordHash],
  );
  const readerId = readerResult.rows[0]?.id;
  console.log(`✓ Seeded demo users (Admin, Publisher, Reader: ${readerId})`);

  // 3. Seed books through the real ingestion pipeline: build each sample EPUB,
  // validate/scan/encrypt/store it, make it the live asset and publish.
  // Safe to repeat, and restores books that migration 0006 delisted on a
  // previously seeded database (their rows keep their ids and purchases).
  const editor = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE email = 'editor@apexpublishing.example'`,
  );
  const editorId = editor.rows[0]?.id ?? null;

  for (const book of sampleBooks) {
    await pool.query(
      `INSERT INTO books (
         id, publisher_id, title, author, isbn13, description,
         genre, language, price_cents, currency, is_available,
         media_type, published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'en', $8, 'EUR', FALSE, 'ebook', CURRENT_DATE)
       ON CONFLICT (id) DO NOTHING`,
      [
        book.id,
        publisherId,
        book.title,
        book.author,
        book.isbn13,
        book.description,
        book.genre,
        book.priceCents,
      ],
    );

    let asset = await currentReadyAsset(book.id);
    if (!asset) {
      const ingested = await ingestNow(
        book.id,
        editorId,
        buildSampleEpub({
          id: book.id,
          title: book.title,
          author: book.author,
          chapters: book.chapters,
        }),
        // The compose worker may claim the job first: wait for it instead of reading `idle`.
        { waitMs: SEED_INGEST_WAIT_MS },
      );
      if (ingested.state !== 'ready') {
        throw new Error(
          `Sample book "${book.title}" was not ingested (${ingested.state}: ${ingested.reason_code ?? 'no reason'})`,
        );
      }
      await activateAsset(book.id, ingested.id, editorId);
      asset = ingested;
    }

    await pool.query(
      `UPDATE books
          SET is_available = TRUE, published_at = COALESCE(published_at, CURRENT_DATE)
        WHERE id = $1`,
      [book.id],
    );
    console.log(`✓ Ingested and published: "${book.title}" (asset v${asset.version})`);
  }

  // 4. Grant first book to demo reader with sample progress, bookmark, and highlight
  if (readerId) {
    const ownedBookId = sampleBooks[0].id;

    // Grant ownership
    await pool.query(
      `INSERT INTO user_libraries (user_id, book_id, reading_progress, last_read_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, book_id) DO UPDATE SET
         reading_progress = EXCLUDED.reading_progress`,
      [
        readerId,
        ownedBookId,
        JSON.stringify({ cfi: 'epubcfi(/6/2[chap_0]!/4/2/4)', percent: 28.5 }),
      ],
    );

    // Access is the entitlement; user_libraries holds reading state.
    await pool.query(
      `INSERT INTO entitlements (user_id, book_id, source)
       VALUES ($1, $2, 'grant')
       ON CONFLICT (user_id, book_id) WHERE status = 'active' DO NOTHING`,
      [readerId, ownedBookId],
    );

    // Seed sample bookmark
    await pool.query(
      `INSERT INTO bookmarks (user_id, book_id, location, label)
       VALUES ($1, $2, 'epubcfi(/6/2[chap_0]!/4/2/2)', 'Interesting observation')
       ON CONFLICT (user_id, book_id, location) DO NOTHING`,
      [readerId, ownedBookId],
    );

    // Seed sample highlight
    await pool.query(
      `INSERT INTO highlights (user_id, book_id, start_location, end_location, highlighted_text, note, color)
       VALUES ($1, $2, 'epubcfi(/6/2!/4/2/1)', 'epubcfi(/6/2!/4/2/2)', 'Elena shielded her eyes from the reflected dawn', 'Visual imagery', 'yellow')
       ON CONFLICT DO NOTHING`,
      [readerId, ownedBookId],
    );

    console.log(`✓ Seeded bookshelf state for demo reader (${sampleBooks[0].title})`);
  }

  console.log('--- Database Seeding Complete ---');
}

// Allow direct CLI execution: `npx tsx src/db/seed.ts`
if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
  runSeed()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seeding failed:', err);
      await pool.end();
      process.exit(1);
    });
}
