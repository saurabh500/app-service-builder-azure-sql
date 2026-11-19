const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasRuntimeMapping, grant } = require('../db/setup');
const { fakeConnection } = require('./helpers/database');

const role = 'shopstream_runtime';
const oid = '11111111-2222-4333-8444-555555555555';
const principal = { name: role, object_id: oid, type: 'E', authentication_type_desc: 'EXTERNAL' };

test('repeated grants reuse only the exact external principal mapping', async () => {
  const connection = fakeConnection(async statement => ({
    recordset: statement.includes('FROM sys.database_principals') ? [principal] : [],
  }));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(hasRuntimeMapping([principal], role, oid, 'service'), true);
    await grant(connection, { RUNTIME_ROLE: role, RUNTIME_OBJECT_ID: oid });
  }
  assert.equal(connection.statements.some(s => s.includes('CREATE USER')), false);
  assert.equal(connection.statements.filter(s => s === 'COMMIT').length, 2);
  assert.equal(hasRuntimeMapping([], role, oid, 'service'), false);
});

test('unknown or changed principal mappings and elevated users cannot receive runtime grants', async () => {
  for (const change of [{ object_id: 'other' }, { type: 'S' }, { authentication_type_desc: 'INSTANCE' }, { name: 'dbo' }]) {
    assert.throws(() => hasRuntimeMapping([{ ...principal, ...change }], role, oid, 'service'), /mapping differs/);
  }
  assert.throws(() => hasRuntimeMapping([principal, principal], role, oid, 'service'), /Unsupported/);
  assert.throws(() => hasRuntimeMapping([null], role, oid, 'service'));
  const connection = fakeConnection(async statement => ({
    recordset: statement.includes('FROM sys.database_principals') ? [principal]
      : statement.includes('AS elevated') ? [{ elevated: 1 }] : [],
  }));
  await assert.rejects(grant(connection, { RUNTIME_ROLE: role, RUNTIME_OBJECT_ID: oid }), /administrator/);
  assert.equal(connection.statements.some(s => s.startsWith('GRANT')), false);
  assert.equal(connection.statements.at(-1), 'ROLLBACK');
});
