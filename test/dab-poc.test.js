const { test } = require('node:test');
const assert = require('node:assert/strict');
const config = require('../dab-poc/dab-config.json');

test('DAB proof exposes only catalog reads, without write roles or additional API surfaces', () => {
  const exposed = Object.values(config.entities);
  assert.deepEqual(exposed.map(entity => entity.source.object).sort(), ['dbo.categories', 'dbo.products']);
  for (const entity of exposed) {
    assert.equal(entity.source.type, 'table');
    assert.deepEqual(entity.permissions, [{ role: 'anonymous', actions: ['read'] }]);
    assert.equal(entity.graphql.enabled, false);
  }
  assert.equal(config.runtime.host.mode, 'production');
  assert.equal(config.runtime.graphql.enabled, false);
  assert.equal(config.runtime.mcp.enabled, false);
  assert.equal(config.runtime.health.enabled, false);
  assert.deepEqual(config.runtime.host.cors, { origins: [], 'allow-credentials': false });
  assert.equal(config['data-source']['connection-string'], "@env('SQL_CONNECTION_STRING')");
});
