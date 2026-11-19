const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../server/db/pool');
const calls = [];
pool.query = async (statement, parameters = []) => {
  calls.push({ statement, parameters });
  return { recordset: [] };
};
const queries = require('../server/db/queries');

test('SQL pagination keeps filters and page bounds in separate bound parameters', async () => {
  for (const [conditions, parameters] of [
    [[], []],
    [['p.name LIKE @p1'], ["%O'Brien%"]],
    [['p.name LIKE @p1', 'p.category_id = @p2'], ["%O'Brien%", 2]],
  ]) {
    calls.length = 0;
    await queries.getProducts(conditions, parameters, 'p.price_cents', 'ASC', 10, 20);
    const page = calls[1];
    assert.deepEqual(page.parameters, [...parameters, 10, 20]);
    assert.match(page.statement, new RegExp(`OFFSET @p${parameters.length + 2} ROWS FETCH NEXT @p${parameters.length + 1} ROWS ONLY`));
    assert.equal(page.statement.includes("O'Brien"), false);
    assert.match(calls[0].statement, /COUNT\(\*\) AS count/);
  }
  for (const status of ['', 'confirmed']) {
    calls.length = 0;
    await queries.getOrders(status, 10, 20);
    assert.deepEqual(calls[1].parameters, status ? [status, 10, 20] : [10, 20]);
    assert.match(calls[1].statement, /o.id DESC/);
  }
});

test('revenue date parts are allowlisted and week uses ISO Monday boundaries', async () => {
  for (const [period, part] of [['day', 'day'], ['week', 'iso_week'], ['month', 'month']]) {
    calls.length = 0;
    await queries.getRevenue(period, 30);
    assert.match(calls[0].statement, new RegExp(`DATETRUNC\\(${part}, created_at\\)`));
    assert.deepEqual(calls[0].parameters, [30]);
  }
  assert.throws(() => queries.getRevenue("day); DROP TABLE orders;--", 30), /Unsupported/);
});
