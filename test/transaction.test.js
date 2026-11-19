const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runTransaction } = require('../server/db/transaction');
const { fakeConnection } = require('./helpers/database');

test('transactions acquire the cross-replica lock, commit healthy work and roll back failed work once', async () => {
  const connection = fakeConnection();
  assert.equal(await runTransaction(connection, async () => 42), 42);
  assert.equal(connection.statements.at(-1), 'COMMIT');
  assert.match(connection.statements[1], /sp_getapplock/);
  assert.match(connection.statements[1], /IF @lockResult < 0 THROW/);
  assert.equal(connection.statements.includes('ROLLBACK'), false);
  const failure = new Error('Mutation failed');
  await assert.rejects(runTransaction(connection, async () => { throw failure; }), failure);
  assert.equal(connection.statements.at(-1), 'ROLLBACK');
  assert.equal(connection.statements.filter(s => s === 'BEGIN').length, 2);
  assert.equal(connection.statements.filter(s => s === 'ROLLBACK').length, 1);
});

test('lock acquisition failure never invokes or replays the mutation', async () => {
  const connection = fakeConnection(async () => { throw new Error('Lock unavailable'); });
  let calls = 0;
  await assert.rejects(runTransaction(connection, async () => { calls++; }), /Lock unavailable/);
  assert.equal(calls, 0);
  assert.equal(connection.statements.at(-1), 'ROLLBACK');
});

test('server-aborted transaction is not rolled back twice', async () => {
  const connection = fakeConnection();
  await assert.rejects(runTransaction(connection, async () => {
    connection.tx.emit('rollback');
    throw new Error('Server aborted');
  }), /Server aborted/);
  assert.equal(connection.statements.includes('ROLLBACK'), false);
});
