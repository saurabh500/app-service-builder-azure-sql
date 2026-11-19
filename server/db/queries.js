const pool = require('./pool');

// Dashboard
exports.getDashboardStats = () => Promise.all([
  pool.query('SELECT COALESCE(SUM(CAST(total_cents AS BIGINT)), 0) AS total FROM orders'),
  pool.query('SELECT COUNT(*) AS count FROM orders'),
  pool.query('SELECT COUNT(*) AS count FROM customers'),
  pool.query('SELECT COUNT(*) AS count FROM products WHERE is_active = 1'),
  pool.query(`
    SELECT TOP (5) v.id, v.name, v.slug, v.rating,
           (SELECT COUNT(*) FROM products p WHERE p.vendor_id = v.id) AS product_count,
           COALESCE(SUM(CAST(oi.total_cents AS BIGINT)), 0) AS revenue
    FROM vendors v
    LEFT JOIN order_items oi ON oi.vendor_id = v.id
    GROUP BY v.id, v.name, v.slug, v.rating ORDER BY revenue DESC, v.id
  `),
  pool.query(`
    SELECT TOP (10) o.id, o.status, o.total_cents, o.created_at,
           c.first_name, c.last_name,
           (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o JOIN customers c ON c.id = o.customer_id
    ORDER BY o.created_at DESC, o.id DESC
  `),
  pool.query(`
    SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC
  `),
]);

// Products
exports.getProducts = (conditions, params, sortColumn, order, limit, offset) => {
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const paramIdx = params.length + 1;
  return Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM products p ${where}`, params),
    pool.query(`
      SELECT p.*, v.name AS vendor_name, v.slug AS vendor_slug,
             cat.name AS category_name, cat.icon AS category_icon
      FROM products p
      JOIN vendors v ON v.id = p.vendor_id
      JOIN categories cat ON cat.id = p.category_id
      ${where}
      ORDER BY ${sortColumn} ${order}, p.id ${order}
      OFFSET @p${paramIdx + 1} ROWS FETCH NEXT @p${paramIdx} ROWS ONLY
    `, [...params, limit, offset]),
  ]);
};

exports.getProductById = (id) => pool.query(`
  SELECT p.*, v.name AS vendor_name, v.slug AS vendor_slug,
         cat.name AS category_name, cat.icon AS category_icon
  FROM products p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  WHERE p.id = @p1
`, [id]);

exports.getProductReviews = (productId) => pool.query(`
  SELECT TOP (20) r.*, c.first_name, c.last_name
  FROM reviews r JOIN customers c ON c.id = r.customer_id
  WHERE r.product_id = @p1 ORDER BY r.created_at DESC, r.id DESC
`, [productId]);

// Search
exports.searchProducts = (query, limit) => pool.query(`
  SELECT TOP (@p2) p.id, p.name, p.slug, p.price_cents, p.rating_avg, p.review_count,
         v.name AS vendor_name, cat.name AS category_name, cat.icon AS category_icon
  FROM products p
  JOIN vendors v ON v.id = p.vendor_id
  JOIN categories cat ON cat.id = p.category_id
  WHERE p.is_active = 1 AND (p.name LIKE @p1 OR p.description LIKE @p1)
  ORDER BY p.rating_avg DESC, p.review_count DESC
`, [`%${query}%`, limit]);

// Categories
exports.getCategories = () => pool.query('SELECT * FROM categories ORDER BY parent_id, name');

// Vendors
exports.getVendors = () => pool.query(`
  SELECT v.*, (SELECT COUNT(*) FROM products p WHERE p.vendor_id = v.id AND p.is_active = 1) AS product_count
  FROM vendors v ORDER BY v.name
`);

exports.getVendorById = (id) => pool.query('SELECT * FROM vendors WHERE id = @p1', [id]);

exports.getVendorProducts = (vendorId) => pool.query(`
  SELECT TOP (50) p.*, cat.name AS category_name
  FROM products p JOIN categories cat ON cat.id = p.category_id
  WHERE p.vendor_id = @p1 AND p.is_active = 1
  ORDER BY p.created_at DESC, p.id DESC
`, [vendorId]);

// Orders
exports.getOrders = (status, limit, offset) => {
  let where = '';
  const params = [];
  if (status) {
    where = 'WHERE o.status = @p1';
    params.push(status);
  }
  const paramOff = params.length;
  return Promise.all([
    pool.query(`SELECT COUNT(*) AS count FROM orders o ${where}`, params),
    pool.query(`
      SELECT o.*, c.first_name, c.last_name, c.email,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
      FROM orders o JOIN customers c ON c.id = o.customer_id
      ${where}
      ORDER BY o.created_at DESC, o.id DESC
      OFFSET @p${paramOff + 2} ROWS FETCH NEXT @p${paramOff + 1} ROWS ONLY
    `, [...params, limit, offset]),
  ]);
};

exports.getOrderById = (id) => pool.query(`
  SELECT o.*, c.first_name, c.last_name, c.email
  FROM orders o JOIN customers c ON c.id = o.customer_id
  WHERE o.id = @p1
`, [id]);

exports.getOrderItems = (orderId) => pool.query(`
  SELECT oi.*, p.name AS product_name, p.slug AS product_slug, v.name AS vendor_name
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN vendors v ON v.id = oi.vendor_id
  WHERE oi.order_id = @p1
`, [orderId]);

// Reviews
exports.createReview = (productId, customerId, rating, title, body, client = pool) => client.query(
  `INSERT INTO reviews (product_id, customer_id, rating, title, body, is_verified)
   OUTPUT INSERTED.*
   VALUES (@p1, @p2, @p3, @p4, @p5, 0)`,
  [productId, customerId, rating, title, body]
);

exports.updateProductRating = (productId, client = pool) => client.query(`
  UPDATE products SET
    rating_avg = COALESCE((SELECT ROUND(AVG(CAST(rating AS DECIMAL(5,2))), 2) FROM reviews WHERE product_id = @p1), 0),
    review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = @p1),
    updated_at = SYSUTCDATETIME()
  WHERE id = @p1
`, [productId]);

// Analytics
exports.getRevenue = (trunc, limit) => {
  const parts = { day: 'day', week: 'iso_week', month: 'month' };
  if (!Object.hasOwn(parts, trunc)) throw new Error('Unsupported revenue period');
  return pool.query(`
  SELECT TOP (@p1) DATETRUNC(${parts[trunc]}, created_at) AS period,
         SUM(CAST(total_cents AS BIGINT)) AS revenue, COUNT(*) AS order_count
  FROM orders
  GROUP BY DATETRUNC(${parts[trunc]}, created_at)
  ORDER BY period DESC
`, [limit]);
};

exports.getTopProducts = (limit) => pool.query(`
  SELECT TOP (@p1) p.id, p.name, p.price_cents, p.rating_avg,
         SUM(oi.quantity) AS total_sold, SUM(CAST(oi.total_cents AS BIGINT)) AS total_revenue,
         v.name AS vendor_name
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN vendors v ON v.id = p.vendor_id
  GROUP BY p.id, p.name, p.price_cents, p.rating_avg, v.name
  ORDER BY total_revenue DESC, p.id
`, [limit]);

// Health
exports.healthCheck = () => pool.query('SELECT SYSUTCDATETIME() AS time, DB_NAME() AS db');
