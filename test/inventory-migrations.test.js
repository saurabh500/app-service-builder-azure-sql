const { test } = require('node:test');
const assert = require('node:assert/strict');
const { migrations, identity, migrate } = require('../db/inventory/setup');

const env = {
  INVENTORY_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  INVENTORY_MANAGER_OBJECT_ID: '22222222-2222-4222-8222-222222222222',
};

function fakePool() {
  const state = { ledger: [], scripts: [], commits: 0, rollbacks: 0, contexts: [] };
  return {
    state,
    transaction() {
      return {
        on() {}, async begin() {},
        async commit() { state.commits++; },
        async rollback() { state.rollbacks++; },
        request() {
          const parameters = {};
          return {
            input(name, type, value) { parameters[name] = value; return this; },
            async batch(text) { state.scripts.push(text); return { recordset: [] }; },
            async query(text) {
              if (text.startsWith('SELECT version, name, checksum')) return { recordset: state.ledger };
              if (text.startsWith('INSERT inventory.schema_migrations')) state.ledger.push({ ...parameters });
              else if (text.startsWith('EXEC sys.sp_set_session_context')) state.contexts.push({ ...parameters });
              else if (!text.includes("N'shopstream-inventory-migrations'")) state.scripts.push(text);
              return { recordset: [] };
            },
          };
        },
      };
    },
  };
}

test('inventory migrations run once across two calls and clear the administrative caller context', async () => {
  const pool = fakePool();
  await migrate(pool, env);
  const statements = [...pool.state.scripts];
  assert.ok(statements.some(text => text.includes('CREATE TABLE inventory.stock')));
  assert.ok(statements.some(text => text.includes('CREATE PROCEDURE inventory.execute_command')));
  await migrate(pool, env);
  assert.deepEqual(pool.state.scripts, statements);
  assert.deepEqual(pool.state.ledger.map(row => row.version), migrations().map(script => script.version));
  assert.equal(pool.state.commits, 2);
  assert.equal(pool.state.rollbacks, 0);
  assert.deepEqual(pool.state.contexts.map(context => [context.tenant_value, context.actor_value]),
    [[env.INVENTORY_TENANT_ID, env.INVENTORY_MANAGER_OBJECT_ID], [null, null],
      [env.INVENTORY_TENANT_ID, env.INVENTORY_MANAGER_OBJECT_ID], [null, null]]);
});

test('changed migration history rolls back without executing source scripts again', async () => {
  const pool = fakePool();
  await migrate(pool, env);
  pool.state.ledger[0].checksum = Buffer.alloc(32);
  const count = pool.state.scripts.length;
  await assert.rejects(migrate(pool, env), /differ from source/);
  assert.equal(pool.state.scripts.length, count);
  assert.equal(pool.state.rollbacks, 1);
});

test('missing, zero or malformed initial identities fail before SQL is reached', async () => {
  for (const value of ['', undefined, '00000000-0000-0000-0000-000000000000', env.INVENTORY_TENANT_ID + 'suffix']) {
    assert.throws(() => identity(value, 'identity'), /nonzero/);
    await assert.rejects(migrate({ transaction() { throw new Error('SQL must not be reached'); } },
      { ...env, INVENTORY_MANAGER_OBJECT_ID: value }), /nonzero/);
  }
});
