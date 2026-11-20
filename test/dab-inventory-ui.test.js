const { test } = require('node:test');
const assert = require('node:assert/strict');
const adapter = import('../dab/ui/src/inventory.mjs');
const caller = { tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const ok = value => ({ ok: true, status: 200, json: async () => ({ value }) });
const receipt = command => ({ request_id: command.request_id, warehouse_id: 1, outcome: 'applied', code: 'applied', on_hand: 10, reserved: 2 });

test('inventory identity is required and warehouse roles come only from the read API', async t => {
  const { loadAccess } = await adapter;
  for (const identity of [[], [caller]]) {
    t.mock.method(globalThis, 'fetch', async url => ok(url.startsWith('/api/access?') ? identity : [{ id: 1, role: 'viewer' }]));
    if (!identity.length) await assert.rejects(loadAccess(), /valid signed-in identity/);
    else assert.equal((await loadAccess()).warehouses[0].role, 'viewer');
  }
});

test('warehouse balances follow all pages while activity reads explicitly request only the latest 100', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(new URL(url, 'https://test.invalid'));
    if (url === '/api/availability?$after=next') return ok([{ warehouse_id: 1, product_id: 2 }]);
    if (url.startsWith('/api/availability?')) return { ...ok([{ warehouse_id: 1, product_id: 1 }]), json: async () => ({ value: [{ warehouse_id: 1, product_id: 1 }], nextLink: '/api/availability?$after=next' }) };
    return ok([]);
  });
  const { loadInventory } = await adapter;
  assert.equal((await loadInventory(1)).stock.length, 2);
  for (const call of calls.filter(url => !url.searchParams.has('$after'))) {
    assert.match(call.searchParams.get('$filter'), /warehouse_id eq 1/);
    assert.equal(call.searchParams.get('$first'), '100');
  }
  t.mock.method(globalThis, 'fetch', async () => ok([{ warehouse_id: 2 }]));
  await assert.rejects(loadInventory(1), /outside the selected warehouse/);
});

test('commands use bounded signed quantities, required adjustment reasons and no browser identity fields', async () => {
  const { createCommand } = await adapter;
  const receive = createCommand({ warehouse: 1, action: 'receive', product: 2, quantity: 10000 });
  assert.equal(receive.quantity, 10000);
  assert.equal(Object.keys(receive).length, 7);
  assert.equal(receive.actor_id, undefined);
  assert.equal(receive.role, undefined);
  assert.equal(createCommand({ warehouse: 1, action: 'adjust', product: 2, quantity: -10000, reason: 'Stock count' }).quantity, -10000);
  for (const quantity of [0, -1, 10001, 1.5, NaN]) assert.throws(() => createCommand({ warehouse: 1, action: 'receive', product: 2, quantity }), /whole quantity/);
  assert.throws(() => createCommand({ warehouse: 1, action: 'adjust', product: 2, quantity: -1, reason: ' ' }), /need a reason/);
  const release = createCommand({ warehouse: 1, action: 'release', reservation: receive.request_id });
  assert.equal(release.product_id, null);
  assert.equal(release.quantity, null);
});

test('pending requests keep the exact payload and ID across refresh and are isolated by signed-in account', async () => {
  const { createCommand, pendingKey, restorePending } = await adapter;
  const command = createCommand({ warehouse: 1, action: 'reserve', product: 2, quantity: 1 });
  const values = new Map([[pendingKey(caller), JSON.stringify(command)]]);
  const storage = { getItem: key => values.get(key) ?? null };
  assert.deepEqual(restorePending(storage, caller), command);
  assert.deepEqual(restorePending(storage, caller), command);
  assert.equal(restorePending(storage, { ...caller, actor_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), null);
  values.set(pendingKey(caller), JSON.stringify({ ...command, actor_id: caller.actor_id }));
  assert.throws(() => restorePending(storage, caller));
});

test('uncertain writes are never automatically replayed and receipt checks never send POST', async t => {
  const { createCommand, sendCommand, checkReceipt } = await adapter;
  const command = createCommand({ warehouse: 1, action: 'reserve', product: 2, quantity: 1 });
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('/api/access?')) return ok([caller]);
    if (options?.method === 'POST') {
      assert.equal(options.headers['X-Inventory-Command'], '1');
      posts++;
      throw new TypeError('Connection lost after submission');
    }
    return ok([]);
  });
  await assert.rejects(sendCommand(command, caller), /Connection lost/);
  assert.equal(await checkReceipt(command, caller), null);
  assert.equal(await checkReceipt(command, caller), null);
  assert.equal(posts, 1);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('/api/access?')) return ok([caller]);
    if (options?.method === 'POST') posts++;
    return ok([receipt(command)]);
  });
  assert.equal((await checkReceipt(command, caller)).outcome, 'applied');
  assert.equal(posts, 1);
});

test('command responses distinguish business rejection from success and reject mismatched or malformed receipts', async t => {
  const { createCommand, sendCommand } = await adapter;
  const command = createCommand({ warehouse: 1, action: 'reserve', product: 2, quantity: 1 });
  const rejected = { ...receipt(command), outcome: 'rejected', code: 'insufficient_stock', on_hand: null, reserved: null };
  t.mock.method(globalThis, 'fetch', async url => ok(url.startsWith('/api/access?') ? [caller] : [rejected]));
  assert.equal((await sendCommand(command, caller)).outcome, 'rejected');
  for (const wrong of [{ ...receipt(command), request_id: crypto.randomUUID() }, { ...receipt(command), warehouse_id: 2 }, { ...receipt(command), reserved: 11 }]) {
    t.mock.method(globalThis, 'fetch', async url => ok(url.startsWith('/api/access?') ? [caller] : [wrong]));
    await assert.rejects(sendCommand(command, caller), /invalid command receipt/);
  }
});

test('switching signed-in accounts prevents replaying the previous account’s saved operation', async t => {
  const { createCommand, sendCommand } = await adapter;
  const command = createCommand({ warehouse: 1, action: 'reserve', product: 2, quantity: 1 });
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options?.method === 'POST') posts++;
    return ok([{ ...caller, actor_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }]);
  });
  await assert.rejects(sendCommand(command, caller), /signed-in account changed/);
  assert.equal(posts, 0);
});

test('SQL UTC timestamps without offsets display the correct instant in a non-UTC browser timezone', async () => {
  const { formatSqlUtc } = await adapter;
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const raw = '2026-07-14T12:00:00.0000000';
    const expected = new Date('2026-07-14T12:00:00Z').toLocaleString();
    assert.notEqual(new Date(raw).toLocaleString(), expected, 'The broken local-time parser must fail in this test timezone');
    assert.equal(formatSqlUtc(raw), expected);
    assert.equal(formatSqlUtc('2026-07-14T12:00:00Z'), expected);
    assert.equal(formatSqlUtc('2026-07-14T14:00:00+02:00'), expected);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
