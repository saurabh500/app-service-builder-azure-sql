-- ShopStream synthetic seed data: 2,525 fictional demonstration rows.
-- Run only through db/setup.js in an empty dedicated database.

-- Vendors (10)
INSERT INTO vendors (name, slug, email, description, logo_url, rating) VALUES
  (N'TechNova', N'technova', N'hello@technova.example.invalid', N'Premium consumer electronics and accessories', NULL, 4.7),
  (N'Urban Threads', N'urban-threads', N'info@urbanthreads.example.invalid', N'Streetwear and contemporary fashion', NULL, 4.5),
  (N'HomeHaven', N'homehaven', N'support@homehaven.example.invalid', N'Modern furniture and home decor', NULL, 4.6),
  (N'FitForge', N'fitforge', N'team@fitforge.example.invalid', N'Performance fitness equipment and gear', NULL, 4.4),
  (N'PureGlow', N'pureglow', N'care@pureglow.example.invalid', N'Clean beauty and skincare essentials', NULL, 4.8),
  (N'PageBound', N'pagebound', N'hello@pagebound.example.invalid', N'Curated books, stationery, and desk accessories', NULL, 4.3),
  (N'ByteGear', N'bytegear', N'sales@bytegear.example.invalid', N'Developer tools, peripherals, and workspace gear', NULL, 4.6),
  (N'GreenRoot', N'greenroot', N'hello@greenroot.example.invalid', N'Sustainable living products and eco-friendly goods', NULL, 4.5),
  (N'LittleLeap', N'littleleap', N'hi@littleleap.example.invalid', N'Educational toys and kids development products', NULL, 4.2),
  (N'TrailEdge', N'trailedge', N'adventure@trailedge.example.invalid', N'Outdoor adventure and camping equipment', NULL, 4.4);

-- Categories (15)
INSERT INTO categories (name, slug, parent_id, icon) VALUES
  (N'Electronics', N'electronics', NULL, N'🔌'),
  (N'Clothing', N'clothing', NULL, N'👕'),
  (N'Home & Garden', N'home-garden', NULL, N'🏠'),
  (N'Sports & Fitness', N'sports-fitness', NULL, N'🏋️'),
  (N'Beauty', N'beauty', NULL, N'✨'),
  (N'Books & Office', N'books-office', NULL, N'📚'),
  (N'Phones & Tablets', N'phones-tablets', 1, N'📱'),
  (N'Laptops & PCs', N'laptops-pcs', 1, N'💻'),
  (N'Audio', N'audio', 1, N'🎧'),
  (N'Men''s Fashion', N'mens-fashion', 2, N'👔'),
  (N'Women''s Fashion', N'womens-fashion', 2, N'👗'),
  (N'Furniture', N'furniture', 3, N'🛋️'),
  (N'Kitchen', N'kitchen', 3, N'🍳'),
  (N'Outdoor Gear', N'outdoor-gear', 4, N'⛺'),
  (N'Skincare', N'skincare', 5, N'🧴');

-- Products (500) via GENERATE_SERIES (compatibility level 160)
INSERT INTO products (vendor_id, category_id, name, slug, description, price_cents, compare_price_cents, sku, stock_qty, is_active, rating_avg, review_count, created_at)
SELECT
  (i % 10) + 1 AS vendor_id,
  (i % 15) + 1 AS category_id,
  CHOOSE((i % 20) + 1,
    N'Pro', N'Ultra', N'Elite', N'Essential', N'Classic', N'Nano', N'Max', N'Lite', N'Prime', N'Core',
    N'Studio', N'Edge', N'Flex', N'Swift', N'Zen', N'Bold', N'Pure', N'Apex', N'Nova', N'Spark'
  ) + N' ' +
  CHOOSE((i % 50) + 1,
    N'Wireless Headphones', N'Running Shoes', N'Desk Lamp', N'Backpack', N'Water Bottle',
    N'Phone Case', N'Yoga Mat', N'Coffee Maker', N'Notebook', N'Sunglasses',
    N'Keyboard', N'T-Shirt', N'Face Cream', N'Camping Tent', N'Wall Art',
    N'Smart Watch', N'Sneakers', N'Throw Pillow', N'Resistance Bands', N'Lip Balm',
    N'Monitor Stand', N'Hoodie', N'Candle Set', N'Dumbbell Set', N'Serum',
    N'USB-C Hub', N'Jacket', N'Plant Pot', N'Jump Rope', N'Tote Bag',
    N'Webcam', N'Joggers', N'Bookshelf', N'Foam Roller', N'Moisturizer',
    N'Power Bank', N'Beanie', N'Table Runner', N'Kettlebell', N'Cleanser',
    N'Desk Mat', N'Polo Shirt', N'Door Mat', N'Ab Wheel', N'Hair Oil',
    N'Charger Cable', N'Scarf', N'Mirror', N'Pull-Up Bar', N'Eye Cream'
  ) AS name,
  CONCAT(N'product-', i) AS slug,
  N'High-quality product crafted with care. Perfect for everyday use.' AS description,
  (1000 + (i * 137) % 15000) AS price_cents,
  CASE WHEN i % 3 = 0 THEN (1500 + (i * 137) % 20000) ELSE NULL END AS compare_price_cents,
  N'SKU-' + RIGHT(N'000000' + CAST(i AS VARCHAR(6)), 6) AS sku,
  (5 + (i * 7) % 200) AS stock_qty,
  1 AS is_active,
  (30 + (i * 13) % 20) / 10.0 AS rating_avg,
  (i * 3) % 50 AS review_count,
  DATEADD(day, -(i % 365), SYSUTCDATETIME())
FROM (SELECT value AS i FROM GENERATE_SERIES(1, 500)) AS s;

-- Customers (200)
INSERT INTO customers (first_name, last_name, email, city, country, created_at)
SELECT
  CHOOSE((i % 20) + 1, N'James',N'Emma',N'Liam',N'Olivia',N'Noah',N'Ava',N'Ethan',N'Sophia',N'Mason',N'Isabella',
         N'Lucas',N'Mia',N'Logan',N'Charlotte',N'Alex',N'Amelia',N'Jack',N'Harper',N'Owen',N'Ella'),
  CHOOSE((i % 20) + 1, N'Smith',N'Johnson',N'Williams',N'Brown',N'Jones',N'Garcia',N'Miller',N'Davis',N'Wilson',N'Anderson',
         N'Taylor',N'Thomas',N'Moore',N'Martin',N'Lee',N'Clark',N'Lewis',N'Walker',N'Hall',N'Young'),
  CONCAT(N'customer', i, N'@example.invalid'),
  CHOOSE((i % 20) + 1, N'New York',N'Los Angeles',N'Chicago',N'Houston',N'Phoenix',N'San Diego',N'Dallas',N'Austin',
         N'Seattle',N'Denver',N'Portland',N'Miami',N'Atlanta',N'Boston',N'Nashville',N'Detroit',
         N'Minneapolis',N'San Francisco',N'Philadelphia',N'Charlotte'),
  N'US',
  DATEADD(day, -(i % 300), SYSUTCDATETIME())
FROM (SELECT value AS i FROM GENERATE_SERIES(1, 200)) AS s;

-- Orders (300)
INSERT INTO orders (customer_id, status, subtotal_cents, tax_cents, shipping_cents, total_cents, shipping_address, created_at)
SELECT
  (i % 200) + 1 AS customer_id,
  CHOOSE((i % 8) + 1, N'pending',N'confirmed',N'processing',N'shipped',N'delivered',N'delivered',N'delivered',N'delivered') AS status,
  sub AS subtotal_cents,
  (sub * 8 / 100) AS tax_cents,
  CASE WHEN sub > 5000 THEN 0 ELSE 599 END AS shipping_cents,
  sub + (sub * 8 / 100) + CASE WHEN sub > 5000 THEN 0 ELSE 599 END AS total_cents,
  N'123 Main St, Anytown, US 12345' AS shipping_address,
  DATEADD(day, -(i % 90), SYSUTCDATETIME())
FROM (
  SELECT i, (2000 + (i * 173) % 30000) AS sub
  FROM (SELECT value AS i FROM GENERATE_SERIES(1, 300)) AS s
) t;

-- Order Items (~1000)
INSERT INTO order_items (order_id, product_id, vendor_id, quantity, unit_price_cents, total_cents)
SELECT
  ((i - 1) / 3) + 1 AS order_id,
  (i % 500) + 1 AS product_id,
  ((i % 500) % 10) + 1 AS vendor_id,
  1 + (i % 3) AS quantity,
  price AS unit_price_cents,
  price * (1 + (i % 3)) AS total_cents
FROM (
  SELECT i, (1000 + (i * 137) % 15000) AS price
  FROM (SELECT value AS i FROM GENERATE_SERIES(1, 900)) AS s
) t
WHERE ((i - 1) / 3) + 1 <= 300;

-- Reviews (400)
INSERT INTO reviews (product_id, customer_id, rating, title, body, is_verified, created_at)
SELECT
  (i % 500) + 1 AS product_id,
  (i % 200) + 1 AS customer_id,
  (3 + (i % 3)) AS rating,
  CHOOSE((i % 20) + 1,
    N'Love it!', N'Great value', N'Exceeded expectations', N'Solid purchase', N'Would buy again',
    N'Pretty good', N'Decent quality', N'Nice product', N'Impressive', N'Highly recommend',
    N'Good but pricey', N'Perfect gift', N'Better than expected', N'Five stars', N'Very happy',
    N'Works great', N'Top notch', N'Fantastic quality', N'Just okay', N'Worth every penny'
  ) AS title,
  CHOOSE((i % 10) + 1,
    N'This product has been amazing for daily use. The quality is outstanding and it arrived quickly.',
    N'Really impressed with the build quality. Exactly what I needed for my home office.',
    N'Great value for the price. I have been using it for a few weeks now and it holds up well.',
    N'The design is sleek and modern. Gets compliments every time someone sees it.',
    N'Purchased as a gift and the recipient loved it. Would definitely buy again.',
    N'Solid product overall. Minor issues with packaging but the item itself is perfect.',
    N'Compared several options before buying this one. No regrets at all.',
    N'Fast shipping and the product matched the description exactly. Very satisfied.',
    N'This is my second purchase from this vendor. Consistent quality every time.',
    N'Good product for the price range. Does exactly what it claims to do.'
  ) AS body,
  CAST(CASE WHEN i % 3 = 0 THEN 1 ELSE 0 END AS BIT) AS is_verified,
  DATEADD(day, -(i % 120), SYSUTCDATETIME())
FROM (SELECT value AS i FROM GENERATE_SERIES(1, 400)) AS s;

-- Inventory Events (~200)
INSERT INTO inventory_events (product_id, event_type, quantity_delta, reason, created_at)
SELECT
  (i % 500) + 1 AS product_id,
  CHOOSE((i % 4) + 1, N'restock',N'sale',N'return',N'adjustment') AS event_type,
  CASE (i % 4)
    WHEN 0 THEN 50 + (i % 100)
    WHEN 1 THEN -(1 + (i % 5))
    WHEN 2 THEN (1 + (i % 3))
    ELSE (i % 20) - 10
  END AS quantity_delta,
  CHOOSE((i % 8) + 1, N'Supplier shipment received',N'Customer purchase',N'Customer return - defective',N'Cycle count adjustment',
         N'Warehouse transfer',N'Bulk order fulfilled',N'Quality inspection removal',N'Promotional restock') AS reason,
  DATEADD(day, -(i % 60), SYSUTCDATETIME())
FROM (SELECT value AS i FROM GENERATE_SERIES(1, 200)) AS s;
