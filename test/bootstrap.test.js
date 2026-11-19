const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootstrap } = require('../db/setup');
const { fakeConnection } = require('./helpers/database');

function database({ marker = 1, version = 1, tables = [] } = {}) {
  return fakeConnection(async (statement) => {
    if (statement.includes('compatibility_level')) return { recordset: [{ compatibility_level: 160 }] };
    if (statement.includes('OBJECT_ID')) return { recordset: [{ marker }] };
    if (statement.includes('sys.tables')) return { recordset: tables };
    if (statement === 'SELECT version FROM dbo.shopstream_bootstrap') {
      return { recordset: version === null ? [] : [{ version }] };
    }
    return { recordset: [] };
  });

}

test('unsupported compatibility level is rejected before schema or data changes', async () => {
  const connection = fakeConnection(async () => ({ recordset: [{ compatibility_level: 150 }] }));
  await assert.rejects(bootstrap(connection), /compatibility level/);
  assert.equal(connection.statements.at(-1), 'ROLLBACK');
  assert.equal(connection.statements.some(s => /CREATE TABLE|INSERT|DELETE|DBCC/.test(s)), false);
});

test('bootstrap twice preserves installed data and shares the mutation lock', async () => {
  const connection = database();
  await bootstrap(connection);
  await bootstrap(connection);
  assert.equal(connection.statements.filter(s => s === 'COMMIT').length, 2);
  assert.equal(connection.statements.some(s => /INSERT|DELETE|DBCC/.test(s)), false);
  assert.match(connection.statements[1], /sp_getapplock/);
});

test('bootstrap refuses non-sample databases, empty markers and unknown versions without data changes', async () => {
  for (const options of [{ marker: null, tables: [{ name: 'unrelated' }] }, { version: null }, { version: 2 }]) {
    for (const reset of [false, true]) {
      const connection = database(options);
      await assert.rejects(bootstrap(connection, reset, { SQL_DATABASE: 'test', SHOPSTREAM_CONFIRM_RESET: 'test' }),
        /empty dedicated database|no version|Unsupported bootstrap version/);
      assert.equal(connection.statements.at(-1), 'ROLLBACK');
      assert.equal(connection.statements.some(s => /INSERT|DELETE|DBCC/.test(s)), false);
    }
  }
});

test('fresh install seeds once; reset requires exact confirmation and deletes before identity reseeding', async () => {
  const fresh = database({ marker: null, version: null });
  await bootstrap(fresh);
  assert.equal(fresh.statements.some(s => s.includes('CREATE TABLE dbo.vendors')), true);
  assert.equal(fresh.statements.some(s => s.includes('GENERATE_SERIES')), true);
  assert.equal(fresh.statements.at(-1), 'COMMIT');
  const connection = database();
  await assert.rejects(bootstrap(connection, true, { SQL_DATABASE: 'test' }), /confirm/);
  assert.equal(connection.statements.length, 0);
  await bootstrap(connection, true, { SQL_DATABASE: 'test', SHOPSTREAM_CONFIRM_RESET: 'test' });
  const resets = connection.statements.filter(s => s.startsWith('DELETE FROM dbo.['));
  assert.equal(resets.length, 8);
  assert.match(resets[0], /order_items.*DBCC CHECKIDENT/);
  assert.match(resets.at(-1), /vendors.*DBCC CHECKIDENT/);
  assert.equal(connection.statements.at(-1), 'COMMIT');
});
