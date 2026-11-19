import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadCatalog, selectProducts } from './catalog.mjs';
import Inventory from './Inventory.jsx';
import './styles.css';

const PAGE_SIZE = 12;
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

function Bag({ className = '' }) {
  return <svg className={className} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 16h24l3 25H9l3-25Z" /><path d="M18 19V12a6 6 0 0 1 12 0v7" />
  </svg>;
}

function Artwork({ category, large = false }) {
  return <div className={`artwork${large ? ' artwork-large' : ''}`} aria-hidden="true">
    <span className="artwork-ring" />
    {category?.icon ? <span className="category-icon">{category.icon}</span> : <Bag />}
    <span className="artwork-caption">{category?.name || 'ShopStream catalog'}</span>
  </div>;
}

function ProductDialog({ product, category, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="detail-title" onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <button className="dialog-close" aria-label="Close product details" onClick={onClose} autoFocus>&times;</button>
    <Artwork category={category} large />
    <div className="detail-content">
      <p className="eyebrow">{category?.name || 'Catalog'}</p>
      <h2 id="detail-title">{product.name}</h2>
      <p className="detail-price">{money(product.price_cents)}
        {product.compare_price_cents > product.price_cents && <del>{money(product.compare_price_cents)}</del>}
      </p>
      <p className="detail-description">{product.description || 'No description available.'}</p>
      <dl className="detail-facts">
        <div><dt>Catalog sample stock</dt><dd>{product.stock_qty > 0 ? `${product.stock_qty} in stock` : 'Out of stock'}</dd></div>
        <div><dt>Rating</dt><dd>{Number(product.rating_avg).toFixed(1)} / 5 ({product.review_count} ratings)</dd></div>
        <div><dt>SKU</dt><dd>{product.sku || 'Not listed'}</dd></div>
        <div><dt>Product ID</dt><dd>{product.id}</dd></div>
      </dl>
      <p className="read-only-note">This is a read-only demo. Checkout and review changes are not enabled.</p>
    </div>
  </dialog>;
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('featured');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    loadCatalog({ signal: controller.signal }).then(setData).catch(failure => {
      if (failure.name !== 'AbortError') setError(failure.message);
    });
    return () => controller.abort();
  }, [refresh]);

  const products = data?.products;
  const categories = data?.categories;
  const filtered = useMemo(() => selectProducts(products || [], categories || [], { search, category, sort }),
    [products, categories, search, category, sort]);
  const categoryMap = useMemo(() => new Map((categories || []).map(item => [item.id, item])), [categories]);
  const chooseCategory = value => { setCategory(value); setVisible(PAGE_SIZE); };

  return <>
    <a className="skip-link" href="#inventory">Skip to inventory</a>
    <header className="site-header">
      <a className="brand" href="/" aria-label="ShopStream home"><span className="brand-mark"><Bag /></span>
        <span>ShopStream<span className="brand-subtitle">THE DAB EDITION</span></span></a>
      <nav aria-label="Main navigation"><a className="nav-active" href="#inventory">Inventory</a><a href="#catalog">Explore catalog</a>
        <a href="/api/products?$first=2" target="_blank" rel="noreferrer">View API <span aria-hidden="true">&#8599;</span></a></nav>
      <span className="read-only-pill"><span />Warehouse-secured demo</span>
    </header>

    <main>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy"><p className="eyebrow">A FAMILIAR STORE. A DIFFERENT ENGINE.</p>
          <h1 id="hero-title">Every unit.<br /><span>Accounted for.</span></h1>
          <p>Receive, reserve and reconcile stock in your assigned warehouses, powered by Data API builder and Azure SQL Serverless.</p>
          <a className="primary-button" href="#inventory">Open inventory <span aria-hidden="true">&#8595;</span></a>
          <div className="stack-tags"><span>React</span><span>Data API builder</span><span>Azure SQL</span></div>
        </div>
        <div className="hero-proof">
          <div className="proof-label"><span className={data ? 'live-dot' : 'pending-dot'} />{data ? 'CONNECTED TO THE LIVE CATALOG' : error ? 'CONNECTION NEEDS ATTENTION' : 'CONNECTING TO THE CATALOG'}</div>
          <div className="proof-numbers"><div><strong>{data ? products.length.toLocaleString() : '--'}</strong><span>products to discover</span></div>
            <div><strong>{data ? categories.length : '--'}</strong><span>curated categories</span></div></div>
          <div className="architecture"><span>Your browser</span><span aria-hidden="true">&#8594;</span><strong>DAB REST API</strong><span aria-hidden="true">&#8594;</span><span>Azure SQL</span></div>
          <p>One Builder app. Same-origin UI and API.<br />Microsoft Entra sign-in. SQL-enforced warehouse access.</p>
        </div>
      </section>

      <Inventory />
      <section className="catalog-section" id="catalog" aria-labelledby="catalog-title">
        <div className="section-heading"><div><p className="eyebrow">THE COLLECTION</p><h2 id="catalog-title">Find your next favorite</h2></div>
          <button className="text-button" disabled={!data && !error} onClick={() => { setSelected(null); setRefresh(value => value + 1); }}>Refresh catalog <span aria-hidden="true">&#8635;</span></button></div>
        {error ? <div className="message-panel error-panel" role="alert"><h3>We couldn't load the catalog</h3><p>{error}</p>
          <div className="message-actions"><button className="primary-button" onClick={() => setRefresh(value => value + 1)}>Try again</button>
            <a href="/.auth/login/aad?post_login_redirect_uri=%2F">Sign in again</a></div></div>
          : !data ? <div className="message-panel" role="status"><span className="spinner" /><h3>Opening the collection</h3>
            <p>Reading products and categories from DAB. Serverless compute may need a moment to resume.</p></div>
          : <div className="catalog-layout">
            <aside className="category-sidebar" aria-label="Product categories"><h3>Categories</h3>
              <button className={!category ? 'category-button selected' : 'category-button'} aria-pressed={!category} onClick={() => chooseCategory('')}>
                <span>All products</span><span className="category-count">{products.length}</span></button>
              {categories.map(item => <button key={item.id} className={category === String(item.id) ? 'category-button selected' : 'category-button'}
                aria-pressed={category === String(item.id)} onClick={() => chooseCategory(String(item.id))}>
                <span>{item.name}</span><span className="category-count">{products.filter(product => product.category_id === item.id).length}</span>
              </button>)}
              <div className="sidebar-note"><strong>Browse freely.</strong><p>Real catalog reads, no purchases or data changes.</p></div>
            </aside>
            <div className="catalog-main">
              <div className="toolbar">
                <label className="search-field"><span className="sr-only">Search the complete catalog</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
                  <input type="search" placeholder="Search products, categories, or SKU..." value={search}
                    onChange={event => { setSearch(event.target.value); setVisible(PAGE_SIZE); }} /></label>
                <label className="sort-field"><span>Sort by</span><select aria-label="Sort products" value={sort}
                  onChange={event => { setSort(event.target.value); setVisible(PAGE_SIZE); }}>
                  <option value="featured">Featured</option><option value="price">Price: low to high</option>
                  <option value="expensive">Price: high to low</option><option value="rating">Top rated</option></select></label>
              </div>
              <p className="results-summary" role="status">{filtered.length} {filtered.length === 1 ? 'product' : 'products'}
                {category && <> in <strong>{categoryMap.get(Number(category))?.name}</strong></>}{search.trim() && <> matching <strong>"{search.trim()}"</strong></>}</p>
              {filtered.length ? <div className="product-grid">
                {filtered.slice(0, visible).map(product => <button className="product-card" key={product.id}
                  onClick={() => setSelected(product)} aria-label={`View ${product.name}`}>
                  <Artwork category={categoryMap.get(product.category_id)} />
                  <div className="product-info"><p className="product-category">{categoryMap.get(product.category_id)?.name}</p>
                    <h3>{product.name}</h3><div className="product-prices"><strong>{money(product.price_cents)}</strong>
                      {product.compare_price_cents > product.price_cents && <del>{money(product.compare_price_cents)}</del>}</div>
                    <div className="product-meta"><span><span className="rating-star" aria-hidden="true">&#9733;</span> {Number(product.rating_avg).toFixed(1)} <span className="rating-count">({product.review_count})</span></span>
                      <span className={product.stock_qty > 0 ? 'stock-label' : 'stock-label out-of-stock'}>{product.stock_qty > 0 ? 'In stock' : 'Out of stock'}</span></div>
                  </div>
                </button>)}
              </div> : <div className="message-panel"><h3>No matching finds</h3><p>Try a different search or category.</p>
                <button className="text-button" onClick={() => { setSearch(''); chooseCategory(''); }}>Clear filters</button></div>}
              <div className="load-more"><span>Showing {Math.min(visible, filtered.length)} of {filtered.length} products</span>
                {visible < filtered.length && <button className="secondary-button" onClick={() => setVisible(value => value + PAGE_SIZE)}>Show more products <span aria-hidden="true">&#8595;</span></button>}</div>
            </div>
          </div>}
      </section>
    </main>
    <footer><span><strong>ShopStream</strong> / The DAB edition</span><span>Fictional inventory. Catalog remains read-only.</span>
      <a href="https://learn.microsoft.com/azure/data-api-builder/" target="_blank" rel="noreferrer">About Data API builder &#8599;</a></footer>
    {selected && <ProductDialog key={selected.id} product={selected} category={categoryMap.get(selected.category_id)} onClose={() => setSelected(null)} />}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
