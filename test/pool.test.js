const { test } = require('node:test');
const assert = require('node:assert/strict');
const sql = require('mssql');
const sqlPath = require.resolve('mssql');
let connects = 0;
let closes = 0;
let rejectFirst;
let resolveSecond;
const calls = [];
class ConnectionPool extends sql.ConnectionPool {
  _poolCreate() {
    connects++;
    return new Promise((resolve, reject) => {
      if (connects === 1) rejectFirst = reject;
      else resolveSecond = () => resolve({});
    });
  }
  async _poolDestroy() {}
  request() {
    const parameters = {};
    return {
      input(name, value) { parameters[name] = value; return this; },
      async query(statement) { calls.push({ statement, parameters }); return { recordset: [{ id: 1 }] }; },
    };
  }
  async close() { closes++; await super.close(); }
}
require.cache[sqlPath] = { id: sqlPath, filename: sqlPath, loaded: true, exports: { ...sql, ConnectionPool } };
process.env.SQL_SERVER = 'test.database.windows.net';
process.env.SQL_DATABASE = 'test';
const pool = require('../server/db/pool');

test('one shared connection attempt; failed resume can recover without replaying queries', async () => {
  const first = pool.query('SELECT @p1', ["value'; DROP TABLE orders;--"]);
  const second = pool.query('SELECT 2');
  const results = Promise.allSettled([first, second]);
  assert.equal(connects, 1);
  rejectFirst(new Error('Database resuming'));
  assert.ok((await results).every(r => r.status === 'rejected'));
  assert.equal(calls.length, 0);
  const third = pool.query('SELECT @p1', ["value'; DROP TABLE orders;--"]);
  const fourth = pool.query('SELECT @p1', [42]);
  assert.equal(connects, 2);
  resolveSecond();
  await Promise.all([third, fourth]);
  assert.deepEqual(calls, [
    { statement: 'SELECT @p1', parameters: { p1: "value'; DROP TABLE orders;--" } },
    { statement: 'SELECT @p1', parameters: { p1: 42 } },
  ]);
  await pool.query('SELECT @p1', [43]);
  assert.equal(connects, 2);
  await pool.close();
  assert.equal(closes, 1);
});
