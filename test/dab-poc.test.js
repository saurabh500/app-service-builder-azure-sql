const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../dab-poc/dab-config.json');

test('DAB exposes authenticated reads plus exactly one POST-only inventory procedure, never generic inventory CRUD', () => {
  const exposed = Object.values(config.entities);
  assert.deepEqual(exposed.filter(entity => entity.source.type === 'table').map(entity => entity.source.object).sort(), ['dbo.categories', 'dbo.products']);
  const commands = exposed.filter(entity => entity.source.type === 'stored-procedure');
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].source, { object: 'inventory.execute_command', type: 'stored-procedure' });
  assert.deepEqual(commands[0].rest, { enabled: true, path: '/commands', methods: ['post'] });
  for (const entity of exposed) {
    assert.ok(['table', 'view', 'stored-procedure'].includes(entity.source.type));
    if (entity.source.type === 'view') assert.ok(entity.source['key-fields'].length);
    assert.deepEqual(entity.permissions, [{ role: 'authenticated', actions: [entity.source.type === 'stored-procedure' ? 'execute' : 'read'] }]);
    assert.equal(entity.graphql.enabled, false);
  }
  assert.equal(config.runtime.host.mode, 'production');
  assert.equal(config.runtime.host.authentication.provider, 'AppService');
  assert.equal(config['data-source'].options['set-session-context'], true);
  assert.equal(config.runtime.graphql.enabled, false);
  assert.equal(config.runtime.mcp.enabled, false);
  assert.equal(config.runtime.health.enabled, false);
  assert.deepEqual(config.runtime.host.cors, { origins: [], 'allow-credentials': false });
  assert.equal(config['data-source']['connection-string'], "@env('SQL_CONNECTION_STRING')");
  assert.equal(config.runtime.telemetry, undefined);
});
