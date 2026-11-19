function nextPage(link, resource) {
  const url = new URL(link, 'https://dab.invalid');
  if (typeof link !== 'string' || !link.startsWith('/') ||
      url.origin !== 'https://dab.invalid' || url.pathname !== resource) {
    throw new Error('The API returned an unsafe pagination link. Data loading stopped.');
  }
  return url.pathname + url.search;
}

export async function readPage(url, signal) {
  const response = await fetch(url, {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your sign-in has expired or access was denied. Sign in again, then retry.');
  }
  if (!response.ok) throw new Error(`The API request failed (HTTP ${response.status}). Please retry.`);
  const page = await response.json().catch(() => {
    throw new Error('The API did not return JSON. Check your sign-in, then retry.');
  });
  if (!Array.isArray(page?.value)) throw new Error('The API returned an unexpected data response.');
  return page;
}

export async function readAll(resource, parameters, signal) {
  let url = resource + '?' + new URLSearchParams(parameters);
  const visited = new Set();
  const rows = [];
  while (url) {
    if (visited.has(url)) {
      throw new Error('The API repeated a pagination link. Data loading stopped.');
    }
    visited.add(url);
    const page = await readPage(url, signal);
    rows.push(...page.value);
    url = page.nextLink == null ? null : nextPage(page.nextLink, resource);
  }
  return rows;
}

export async function loadCatalog({ signal } = {}) {
  // shortcut: search uses the small demo catalog in memory; use a SQL search view for a large catalog.
  const [products, categories] = await Promise.all([
    readAll('/api/products', {
      '$first': '100',
      '$filter': 'is_active eq true',
      '$orderby': 'id asc',
      '$select': 'id,name,description,price_cents,compare_price_cents,stock_qty,category_id,sku,rating_avg,review_count',
    }, signal),
    readAll('/api/categories', {
      '$first': '100',
      '$orderby': 'id asc',
      '$select': 'id,name,icon',
    }, signal),
  ]);
  return { products, categories };
}

export function selectProducts(products, categories, { search = '', category = '', sort = 'featured' } = {}) {
  const names = new Map(categories.map(item => [item.id, item.name]));
  const term = search.trim().toLocaleLowerCase();
  const comparators = {
    featured: (a, b) => a.id - b.id,
    price: (a, b) => a.price_cents - b.price_cents || a.id - b.id,
    expensive: (a, b) => b.price_cents - a.price_cents || a.id - b.id,
    rating: (a, b) => b.rating_avg - a.rating_avg || a.id - b.id,
  };
  return products.filter(product =>
    (!category || product.category_id === Number(category)) &&
    (!term || [product.name, product.description, product.sku, names.get(product.category_id)]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(term)))
  ).sort(comparators[sort] || comparators.featured);
}
