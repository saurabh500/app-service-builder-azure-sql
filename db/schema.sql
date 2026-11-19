-- ShopStream Schema
-- Multi-Vendor E-Commerce Marketplace

CREATE TABLE dbo.vendors (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  name          NVARCHAR(200) NOT NULL,
  slug          NVARCHAR(200) NOT NULL UNIQUE,
  email         NVARCHAR(255) NOT NULL,
  description   NVARCHAR(MAX),
  logo_url      NVARCHAR(500),
  rating        NUMERIC(3,2) DEFAULT 0,
  created_at    DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.categories (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  name          NVARCHAR(100) NOT NULL,
  slug          NVARCHAR(100) NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES categories(id),
  icon          NVARCHAR(10)
);

CREATE TABLE dbo.products (
  id                  INT IDENTITY(1,1) PRIMARY KEY,
  vendor_id           INTEGER NOT NULL REFERENCES vendors(id),
  category_id         INTEGER NOT NULL REFERENCES categories(id),
  name                NVARCHAR(300) NOT NULL,
  slug                NVARCHAR(300) NOT NULL,
  description         NVARCHAR(MAX),
  price_cents         INTEGER NOT NULL,
  compare_price_cents INTEGER,
  sku                 NVARCHAR(50),
  image_url           NVARCHAR(500),
  stock_qty           INTEGER NOT NULL DEFAULT 0,
  is_active           BIT DEFAULT 1,
  rating_avg          NUMERIC(3,2) DEFAULT 0,
  review_count        INTEGER DEFAULT 0,
  created_at          DATETIME2 DEFAULT SYSUTCDATETIME(),
  updated_at          DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.customers (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  first_name    NVARCHAR(100) NOT NULL,
  last_name     NVARCHAR(100) NOT NULL,
  email         NVARCHAR(255) NOT NULL UNIQUE,
  password_hash NVARCHAR(255) NOT NULL DEFAULT '',
  avatar_url    NVARCHAR(500),
  city          NVARCHAR(100),
  country       NVARCHAR(100),
  created_at    DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.orders (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES customers(id),
  status            NVARCHAR(30) NOT NULL DEFAULT 'pending',
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  shipping_address  NVARCHAR(MAX),
  created_at        DATETIME2 DEFAULT SYSUTCDATETIME(),
  updated_at        DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.order_items (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_cents     INTEGER NOT NULL
);

CREATE TABLE dbo.reviews (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         NVARCHAR(200),
  body          NVARCHAR(MAX),
  is_verified   BIT DEFAULT 0,
  created_at    DATETIME2 DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.inventory_events (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  product_id      INTEGER NOT NULL REFERENCES products(id),
  event_type      NVARCHAR(30) NOT NULL,
  quantity_delta   INTEGER NOT NULL,
  reason          NVARCHAR(200),
  created_at      DATETIME2 DEFAULT SYSUTCDATETIME()
);

-- Indexes
CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_created ON products(created_at);
CREATE INDEX idx_products_active ON products(is_active) WHERE is_active = 1;
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_reviews_product ON reviews(product_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);
CREATE INDEX idx_inventory_product ON inventory_events(product_id);
CREATE INDEX idx_inventory_created ON inventory_events(created_at);
