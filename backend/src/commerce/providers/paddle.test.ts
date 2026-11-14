import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signWebhook, WebhookVerificationError } from '../signature';
import { PADDLE_SIGNATURE_HEADER, PaddleProvider } from './paddle';
import { PaymentProviderError } from './types';

const SECRET = 'pdl_ntfset_unit_test';
const TXN_ID = '11111111-1111-4111-8111-111111111111';

function provider(fetchImpl?: typeof fetch) {
  return new PaddleProvider({
    apiKey: 'pdl_sdbx_apikey_test',
    webhookSecret: SECRET,
    environment: 'sandbox',
    toleranceSeconds: 5,
    fetch: fetchImpl,
  });
}

function deliver(payload: unknown, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = signWebhook(raw, secret);
  return provider().parseWebhook(raw, (name) =>
    name.toLowerCase() === PADDLE_SIGNATURE_HEADER ? signature : undefined,
  );
}

const envelope = (eventType: string, data: unknown) => ({
  event_id: 'evt_01abc',
  event_type: eventType,
  occurred_at: '2026-11-13T10:00:00.000Z',
  notification_id: 'ntf_01abc',
  data,
});

describe('PaddleProvider.createCheckout', () => {
  it('sends server-side EUR prices as tax-inclusive ebook items and maps price ids back', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(
        JSON.stringify({
          data: {
            id: 'txn_01paddle',
            checkout: { url: 'https://pay.example.com/checkout?_ptxn=txn_01paddle' },
            items: [
              { price: { id: 'pri_b', custom_data: { libraria_item_id: 'item-b' } } },
              { price: { id: 'pri_a', custom_data: { libraria_item_id: 'item-a' } } },
            ],
          },
        }),
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const result = await provider(fakeFetch).createCheckout({
      transactionId: TXN_ID,
      currency: 'EUR',
      items: [
        { itemId: 'item-a', bookId: 'book-a', title: 'A', unitPriceCents: 499 },
        { itemId: 'item-b', bookId: 'book-b', title: 'B', unitPriceCents: 1299 },
      ],
    });

    assert.equal(captured?.url, 'https://sandbox-api.paddle.com/transactions');
    const headers = captured?.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer pdl_sdbx_apikey_test');

    const body = JSON.parse(String(captured?.init.body));
    assert.equal(body.custom_data.libraria_transaction_id, TXN_ID);
    assert.equal(body.items[0].price.unit_price.amount, '499');
    assert.equal(body.items[0].price.unit_price.currency_code, 'EUR');
    assert.equal(body.items[0].price.tax_mode, 'internal');
    assert.equal(body.items[0].price.product.tax_category, 'ebooks');

    assert.equal(result.providerTransactionId, 'txn_01paddle');
    assert.equal(result.checkoutUrl, 'https://pay.example.com/checkout?_ptxn=txn_01paddle');
    // Matched by echoed custom data, not by array position.
    assert.deepEqual(result.priceIds, { 'item-a': 'pri_a', 'item-b': 'pri_b' });
  });

  it('wraps HTTP errors and network failures as PaymentProviderError', async () => {
    const failing = (async () =>
      new Response(JSON.stringify({ error: { code: 'forbidden' } }), {
        status: 403,
      })) as unknown as typeof fetch;
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    const request = {
      transactionId: TXN_ID,
      currency: 'EUR',
      items: [{ itemId: 'i', bookId: 'b', title: 'T', unitPriceCents: 1 }],
    };
    await assert.rejects(provider(failing).createCheckout(request), PaymentProviderError);
    await assert.rejects(provider(offline).createCheckout(request), PaymentProviderError);
  });
});

describe('PaddleProvider.parseWebhook', () => {
  it('rejects webhooks not signed with our secret', () => {
    assert.throws(
      () => deliver(envelope('transaction.completed', {}), 'wrong-secret'),
      WebhookVerificationError,
    );
  });

  it('maps transaction.completed to a payment with totals and line items', () => {
    const event = deliver(
      envelope('transaction.completed', {
        id: 'txn_01paddle',
        status: 'completed',
        custom_data: { libraria_transaction_id: TXN_ID },
        details: {
          totals: {
            subtotal: '416',
            tax: '83',
            total: '499',
            fee: '75',
            earnings: '341',
            currency_code: 'EUR',
          },
          line_items: [{ id: 'txnitm_1', price_id: 'pri_a', totals: { tax: '83', total: '499' } }],
        },
      }),
    );

    assert.equal(event.kind, 'payment_succeeded');
    if (event.kind !== 'payment_succeeded') return;
    assert.equal(event.providerEventId, 'evt_01abc');
    assert.equal(event.internalTransactionId, TXN_ID);
    assert.equal(event.providerTransactionId, 'txn_01paddle');
    assert.deepEqual(event.totals, {
      currency: 'EUR',
      subtotalCents: 416,
      taxCents: 83,
      totalCents: 499,
      feeCents: 75,
      earningsCents: 341,
    });
    assert.deepEqual(event.lineItems, [
      { providerLineItemId: 'txnitm_1', providerPriceId: 'pri_a', taxCents: 83, totalCents: 499 },
    ]);
  });

  it('maps the billing country, or null without an address', () => {
    const completed = (extra: object) =>
      deliver(
        envelope('transaction.completed', {
          id: 'txn_01paddle',
          ...extra,
          details: {
            totals: { subtotal: '416', tax: '83', total: '499', currency_code: 'EUR' },
            line_items: [],
          },
        }),
      );
    const withAddress = completed({ address: { country_code: 'AL' } });
    const without = completed({});
    assert.equal(withAddress.kind, 'payment_succeeded');
    assert.equal(without.kind, 'payment_succeeded');
    if (withAddress.kind !== 'payment_succeeded' || without.kind !== 'payment_succeeded') return;
    assert.equal(withAddress.countryCode, 'AL');
    assert.equal(without.countryCode, null);

    // A malformed country must never drop the payment event.
    for (const bad of [42, { code: 'AL' }, ['AL']]) {
      const odd = completed({ address: { country_code: bad } });
      assert.equal(odd.kind, 'payment_succeeded');
      if (odd.kind === 'payment_succeeded') assert.equal(odd.countryCode, null);
    }
  });

  it('does not fulfil on transaction.paid (fulfilment keys off completed)', () => {
    const event = deliver(envelope('transaction.paid', { id: 'txn_01paddle' }));
    assert.equal(event.kind, 'ignored');
  });

  it('ignores, rather than guesses at, a completed event it cannot parse', () => {
    const event = deliver(
      envelope('transaction.completed', {
        id: 'txn_01paddle',
        details: { totals: { total: '4.99', currency_code: 'EUR' } },
      }),
    );
    assert.equal(event.kind, 'ignored');
    assert.equal(event.providerEventId, 'evt_01abc');
  });

  it('only acts on approved refunds, mapping full and partial lines', () => {
    const adjustment = (status: string) =>
      envelope('adjustment.updated', {
        id: 'adj_01',
        action: 'refund',
        status,
        transaction_id: 'txn_01paddle',
        items: [
          { item_id: 'txnitm_1', type: 'full', amount: '499' },
          { item_id: 'txnitm_2', type: 'partial', amount: '100' },
        ],
        totals: { total: '599' },
      });

    assert.equal(deliver(adjustment('pending_approval')).kind, 'ignored');
    assert.equal(deliver(adjustment('rejected')).kind, 'ignored');

    const approved = deliver(adjustment('approved'));
    assert.equal(approved.kind, 'refund');
    if (approved.kind !== 'refund') return;
    assert.equal(approved.adjustmentId, 'adj_01');
    assert.equal(approved.providerTransactionId, 'txn_01paddle');
    assert.deepEqual(approved.lines, [
      { providerLineItemId: 'txnitm_1', full: true, amountCents: 499 },
      { providerLineItemId: 'txnitm_2', full: false, amountCents: 100 },
    ]);
  });

  it('maps the chargeback lifecycle', () => {
    const adjustment = (action: string) =>
      deliver(
        envelope('adjustment.created', {
          id: 'adj_02',
          action,
          status: 'approved',
          transaction_id: 'txn_01paddle',
          items: [],
          totals: { total: '499' },
        }),
      ).kind;

    assert.equal(adjustment('chargeback_warning'), 'dispute_opened');
    assert.equal(adjustment('chargeback'), 'chargeback');
    assert.equal(adjustment('chargeback_reverse'), 'dispute_won');
    assert.equal(adjustment('chargeback_warning_reverse'), 'dispute_won');
    assert.equal(adjustment('credit'), 'ignored');
  });

  it('maps failed and cancelled checkouts', () => {
    const data = { id: 'txn_01paddle', custom_data: { libraria_transaction_id: TXN_ID } };
    assert.equal(deliver(envelope('transaction.payment_failed', data)).kind, 'payment_failed');
    assert.equal(deliver(envelope('transaction.canceled', data)).kind, 'checkout_cancelled');
  });
});

describe('PaddleProvider.lookupCountry', () => {
  it('fetches the transaction with its address and returns the country', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, auth: new Headers(init?.headers).get('Authorization') };
      return new Response(JSON.stringify({ data: { address: { country_code: 'XK' } } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    assert.equal(await provider(fetchImpl).lookupCountry('txn_1'), 'XK');
    assert.equal(seen?.url, 'https://sandbox-api.paddle.com/transactions/txn_1?include=address');
    assert.equal(seen?.auth, 'Bearer pdl_sdbx_apikey_test');
  });

  it('returns null on an HTTP error', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    assert.equal(await provider(fetchImpl).lookupCountry('txn_1'), null);
  });

  it('returns null on a network error', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    assert.equal(await provider(fetchImpl).lookupCountry('txn_1'), null);
  });
});
