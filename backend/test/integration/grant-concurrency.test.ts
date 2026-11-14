import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, it } from 'node:test';
import {
  type Api,
  buy,
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  startTestServer,
  type TestServer,
} from './harness';

let server: TestServer;
let api: Api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});
after(async () => {
  await server.close();
});

it('parallel decryption and download grants from one device never fail with 5xx', async () => {
  const pub = await createPublisher();
  const books: string[] = [];
  for (let i = 0; i < 10; i++) books.push(await createBook(pub));
  const buyer = await createUser();
  await buy(api, buyer.token, books);
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const dev = await api('POST', '/devices', {
    token: buyer.token,
    body: {
      platform: 'android',
      displayName: 'P',
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    },
  });
  assert.equal(dev.status, 201);
  const deviceId = dev.body.device.id;
  const assets: string[] = [];
  for (const b of books) {
    const { rows } = await pool.query('SELECT current_asset_id FROM books WHERE id = $1', [b]);
    assets.push(rows[0].current_asset_id);
  }

  // 2 rounds x 10 books x 2 grant kinds = 40 parallel requests; each asset sees 4 (< 10/hour),
  // the user sees 40 (< 300/hour), so every one must be allowed.
  const statuses: number[] = [];
  for (let round = 0; round < 2; round++) {
    const requests = assets.flatMap((asset) => [
      api('POST', `/assets/${asset}/decryption-authorizations`, {
        token: buyer.token,
        body: { deviceId },
      }),
      api('POST', `/assets/${asset}/download-authorizations`, {
        token: buyer.token,
        body: { deviceId },
      }),
    ]);
    for (const response of await Promise.all(requests)) statuses.push(response.status);
  }
  assert.equal(statuses.length, 40);
  assert.deepEqual(
    statuses.filter((s) => s !== 200),
    [],
    'every parallel grant is allowed',
  );
});
