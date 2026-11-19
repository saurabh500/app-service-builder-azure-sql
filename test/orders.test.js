const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const pool = require('../server/db/pool');
const { fakeConnection } = require('./helpers/database');
let counts = { orders: 0, events: 0 };
let failConnect = false;
let stock = 0;
const connection = fakeConnection(async (statement) => {
  if (statement.includes('COUNT(*) FROM orders')) return { recordset: [{ ...counts }] };
  if (statement.startsWith('SELECT id FROM customers')) return { recordset: [{ id: 1 }] };
  if (statement.startsWith('SELECT id, vendor_id')) return { recordset: [{ id: 1, vendor_id: 1, price_cents: 100, stock_qty: stock }] };
  if (statement.includes('INSERT INTO orders (')) return { recordset: [{ id: ++counts.orders }] };
  if (statement.includes('INSERT INTO inventory_events')) counts.events++;
  return { recordset: [] };
});
const statements = connection.statements;
pool.connect = async () => {
  if (failConnect) throw Object.assign(new Error('Should not expose secret details'), { code: 'AUTH_FAILED' });
  return connection;
};
const router = require('../server/routes/orders');
const errorHandler = require('../server/middleware/errorHandler');

test('order validation never opens a transaction; capacity, stock and auth failures roll back safely', async () => {
  const app = express();
  app.use(express.json());
  app.use('/orders', router);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const response = await fetch(origin + '/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (const quantity of [-1, 0, 1.5, '2oops', 101]) {
      assert.equal((await post({ customer_id: 1, items: [{ product_id: 1, quantity }] })).status, 400);
    }
    assert.equal(statements.length, 0);
    const body = { customer_id: 1, items: [{ product_id: 1, quantity: 1 }] };
    for (const value of [{ orders: '1000', events: '0' }, { orders: '0', events: '5000' }]) {
      counts = value;
      assert.equal((await post(body)).status, 409);
      assert.equal(statements.at(-1), 'ROLLBACK');
    }
    counts = { orders: '0', events: '0' };
    assert.equal((await post(body)).status, 409);
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(statements.filter(s => s === 'ROLLBACK').length, 3);
    stock = 10;
    counts = { orders: 998, events: 4998 };
    assert.equal((await post(body)).status, 201);
    assert.equal((await post(body)).status, 201);
    assert.equal((await post(body)).status, 409);
    assert.deepEqual(counts, { orders: 1000, events: 5000 });
    assert.equal(statements.filter(s => s === 'COMMIT').length, 2);
    failConnect = true;
    const failure = await post(body);
    assert.equal(failure.status, 503);
    assert.equal(JSON.stringify(failure.body).includes('secret details'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
