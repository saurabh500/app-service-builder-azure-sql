const { test } = require('node:test');
const assert = require('node:assert/strict');

const catalog = import('../dab-poc/ui/src/catalog.mjs');
const product = { id: 1, name: 'Running Shoes', description: 'Everyday comfort', sku: 'RUN-1', category_id: 2, price_cents: 1500, rating_avg: 4.5 };
const category = { id: 2, name: 'Footwear' };
const ok = value => ({ ok: true, status: 200, json: async () => value });

test('DAB UI follows all relative pages with GET and same-origin credentials, preserving the full catalog', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/api/categories?')) return ok({ value: [category] });
    if (url === '/api/products?$after=cursor') return ok({ value: [{ ...product, id: 2 }] });
    return ok({ value: [product], nextLink: '/api/products?$after=cursor' });
  });
  const data = await (await catalog).loadCatalog();
  assert.deepEqual(data.products.map(item => item.id), [1, 2]);
  assert.deepEqual(data.categories, [category]);
  assert.equal(calls.length, 3);
  for (const { options } of calls) {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, undefined);
  }
});

test('DAB UI stops before requesting foreign origins, other endpoints or malformed next links', async t => {
  for (const link of ['https://outside.invalid/api/products', '//outside.invalid/api/products', '/api/orders', '', 12]) {
    let unsafeRequested = false;
    t.mock.method(globalThis, 'fetch', async url => {
      if (url.startsWith('/api/categories?')) return ok({ value: [category] });
      if (!url.startsWith('/api/products?%24first=')) unsafeRequested = true;
      return ok({ value: [product], nextLink: link });
    });
    await assert.rejects((await catalog).loadCatalog(), /unsafe pagination link/);
    assert.equal(unsafeRequested, false);
  }
});

test('DAB UI reports expired sign-in and HTTP failures instead of showing an empty successful catalog', async t => {
  for (const status of [401, 403, 500]) {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status }));
    await assert.rejects((await catalog).loadCatalog(), status === 500 ? /HTTP 500/ : /sign-in has expired or access was denied/);
  }
});

test('DAB UI rejects invalid JSON, wrong response shapes and repeated pagination links', async t => {
  const cases = [
    { response: { ok: true, status: 200, json: async () => { throw new SyntaxError('HTML'); } }, message: /did not return JSON/ },
    { response: ok({ products: [] }), message: /unexpected data response/ },
    { response: ok({ value: [], nextLink: '/api/products?$after=same' }), message: /repeated a pagination link/ },
  ];
  for (const { response, message } of cases) {
    t.mock.method(globalThis, 'fetch', async url => url.startsWith('/api/categories?') ? ok({ value: [] }) : response);
    await assert.rejects((await catalog).loadCatalog(), message);
  }
});

test('DAB UI searches the complete snapshot, combines category filters and sorts without changing source rows', async () => {
  const { selectProducts } = await catalog;
  const products = [
    { ...product, id: 2, name: "Chef's Knife", category_id: 3, price_cents: 2500 },
    product,
    { ...product, id: 3, name: 'Walking Boots', sku: 'BOOT-3', price_cents: 5000 },
  ];
  const categories = [category, { id: 3, name: 'Kitchen' }];
  assert.deepEqual(selectProducts(products, categories, { search: "CHEF'S" }).map(item => item.id), [2]);
  assert.deepEqual(selectProducts(products, categories, { search: 'footwear', category: '2', sort: 'expensive' }).map(item => item.id), [3, 1]);
  assert.deepEqual(selectProducts(products, categories, { search: 'BOOT-3' }).map(item => item.id), [3]);
  assert.deepEqual(selectProducts(products, categories, { search: 'missing' }), []);
  assert.deepEqual(products.map(item => item.id), [2, 1, 3]);
});
