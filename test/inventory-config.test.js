const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConfig } = require('../db/inventory/config');

const env = { SQL_SERVER: 'sample.database.windows.net', SQL_DATABASE: 'shopstream' };

test('hosted identity cannot fall back to developer credentials and uses verified TLS and an idle pool', () => {
  const config = createConfig(env);
  assert.equal(config.authentication.type, 'azure-active-directory-msi-app-service');
  assert.equal(config.options.encrypt, true);
  assert.equal(config.options.trustServerCertificate, false);
  assert.deepEqual(config.pool, { min: 0, max: 5, idleTimeoutMillis: 30000 });
  assert.equal(config.options.maxRetriesOnTransientErrors, 0);
  assert.equal(config.connectionTimeout, 60000);
  assert.equal(createConfig({ ...env, ENTRA_CREDENTIAL: 'default' }).authentication.type, 'azure-active-directory-default');
  assert.equal(createConfig({ ...env, AZURE_CLIENT_ID: 'test-client-id' }).authentication.options.clientId, 'test-client-id');
});

test('invalid/missing config and unsafe authentication fail explicitly', () => {
  for (const key of ['SQL_SERVER', 'SQL_DATABASE']) {
    assert.throws(() => createConfig({ ...env, [key]: '' }), new RegExp(key));
  }
  for (const overrides of [
    { DATABASE_URL: 'sqlserver://example' }, { SQL_PASSWORD: 'not-a-real-secret' },
    { SQL_USER: 'sa' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { ENTRA_CREDENTIAL: 'password' }, { SQL_PORT: 'NaN' }, { SQL_PORT: '0' }, { SQL_PORT: '65536' },
  ]) assert.throws(() => createConfig({ ...env, ...overrides }));
});

test('Builder routing uses the native parser, never its credentials, TLS or pooling overrides', () => {
  const routing = 'Server=tcp:sample.database.windows.net,1433;Database=shopstream;Encrypt=True;TrustServerCertificate=False;Authentication=Active Directory Managed Identity;';
  const config = createConfig({ SQL_CONNECTION_STRING: routing });
  assert.equal(config.server, env.SQL_SERVER);
  assert.equal(config.database, env.SQL_DATABASE);
  assert.equal(config.authentication.type, 'azure-active-directory-msi-app-service');
  for (const suffix of ['Password=secret;', 'User Id=sa;', 'Encrypt=False;', 'TrustServerCertificate=True;', 'Token=secret;', 'Client Secret=secret;']) {
    assert.throws(() => createConfig({ SQL_CONNECTION_STRING: routing + suffix }));
  }
  assert.throws(() => createConfig({ ...env, SQL_CONNECTION_STRING: routing }), /not both/);
  assert.throws(() => createConfig({ SQL_CONNECTION_STRING: "Server='private-unclosed-value" }),
    error => error.message.includes('SQL_CONNECTION_STRING is invalid') && !error.message.includes('private-unclosed-value'));
});
