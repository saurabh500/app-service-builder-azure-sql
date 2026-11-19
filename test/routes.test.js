const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const pool = require('../server/db/pool');
const { fakeConnection } = require('./helpers/database');

const calls = [];
let fail = false;
let reviewCount = 998;
async function execute(statement, parameters = []) {
  calls.push({ statement, parameters });
  if (fail) throw Object.assign(new Error('private connection details'), { code: 'ETIMEOUT' });
  let rows = [{ id: 1, product_id: 1, name: 'Demo', status: 'confirmed', vendor_id: 1, price_cents: 100, stock_qty: 10 }];
  if (statement.includes('INSERT INTO reviews')) reviewCount++;
  if (statement === 'SELECT COUNT(*) AS count FROM reviews') rows = [{ count: reviewCount }];
  else if (statement.includes('COUNT(*) FROM orders')) rows = [{ orders: 0, events: 0 }];
  else if (statement.includes('COUNT(*) AS count')) rows = [{ count: 1 }];
  else if (statement.includes(' AS total FROM')) rows = [{ total: '100' }];
  return { recordset: rows };
}
pool.query = execute;
pool.connect = async () => fakeConnection(execute);

test('all route families preserve JSON shapes with native mssql recordsets; liveness never queries SQL', async () => {
  const app = express();
  app.use(express.json());
  app.use('/', require('../server/routes/health'));
  for (const route of ['dashboard', 'products', 'vendors', 'categories', 'orders', 'reviews', 'analytics', 'reset']) {
    app.use(`/api/${route}`, require(`../server/routes/${route}`));
  }
  app.use(require('../server/middleware/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(origin + path, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('/health/live')).status, 200);
    assert.equal(calls.length, 0);
    for (const [path, field] of [
      ['/api/products?search=Demo&category=1&sort=price&order=asc', 'products'],
      ['/api/products/search?q=Demo', 'results'],
      ['/api/products/1', 'reviews'],
      ['/api/vendors', 'vendors'],
      ['/api/vendors/1', 'products'],
      ['/api/categories', 'categories'],
      ['/api/orders?status=confirmed', 'orders'],
      ['/api/orders/1', 'items'],
      ['/api/analytics/revenue?period=week', 'revenue'],
      ['/api/analytics/top-products', 'products'],
    ]) {
      const response = await request(path);
      assert.equal(response.status, 200, path);
      assert.ok(Array.isArray(response.body[field]), path);
    }
    const dashboard = await request('/api/dashboard');
    assert.equal(dashboard.body.revenue_cents, 100);
    assert.equal(dashboard.body.product_count, 1);
    assert.ok(Array.isArray(dashboard.body.top_vendors));
    assert.equal((await request('/api/orders/1', 'PATCH', { status: 'processing' })).status, 200);
    const review = { product_id: 1, customer_id: 1, rating: 5 };
    assert.equal((await request('/api/reviews', 'POST', review)).status, 201);
    assert.equal((await request('/api/reviews', 'POST', review)).status, 201);
    assert.equal((await request('/api/reviews', 'POST', review)).status, 409);
    assert.equal(reviewCount, 1000);
    assert.equal((await request('/api/reviews/1', 'DELETE')).status, 200);
    assert.equal((await request('/api/reset', 'POST', {})).status, 403);
    assert.ok(calls.some(c => /OUTPUT INSERTED/.test(c.statement)));
    assert.ok(calls.some(c => /OUTPUT DELETED/.test(c.statement)));
    fail = true;
    const error = await request('/health');
    assert.equal(error.status, 503);
    assert.equal(JSON.stringify(error.body).includes('private connection details'), false);
    assert.equal((await request('/health/live')).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
