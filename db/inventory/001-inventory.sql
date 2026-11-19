CREATE TABLE inventory.warehouses (
  id INT IDENTITY PRIMARY KEY,
  name NVARCHAR(80) NOT NULL UNIQUE
);
CREATE TABLE inventory.warehouse_members (
  warehouse_id INT NOT NULL REFERENCES inventory.warehouses(id),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  actor_id UNIQUEIDENTIFIER NOT NULL,
  role VARCHAR(8) NOT NULL CHECK (role IN ('viewer', 'operator', 'manager')),
  PRIMARY KEY (warehouse_id, tenant_id, actor_id)
);
CREATE TABLE inventory.stock (
  warehouse_id INT NOT NULL REFERENCES inventory.warehouses(id),
  product_id INT NOT NULL REFERENCES dbo.products(id),
  on_hand INT NOT NULL CHECK (on_hand BETWEEN 0 AND 1000000),
  reserved INT NOT NULL DEFAULT 0,
  reorder_point INT NOT NULL DEFAULT 5 CHECK (reorder_point BETWEEN 0 AND 1000000),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  PRIMARY KEY (warehouse_id, product_id),
  CHECK (reserved BETWEEN 0 AND on_hand)
);
CREATE TABLE inventory.reservations (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  status VARCHAR(8) NOT NULL CHECK (status IN ('reserved', 'released')),
  actor_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  released_at DATETIME2 NULL,
  FOREIGN KEY (warehouse_id, product_id) REFERENCES inventory.stock(warehouse_id, product_id)
);
CREATE TABLE inventory.requests (
  request_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
  warehouse_id INT NOT NULL REFERENCES inventory.warehouses(id),
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  actor_id UNIQUEIDENTIFIER NOT NULL,
  payload_hash BINARY(32) NOT NULL,
  outcome VARCHAR(12) NOT NULL CHECK (outcome IN ('applied', 'rejected')),
  code VARCHAR(40) NOT NULL,
  product_id INT NULL,
  reservation_id UNIQUEIDENTIFIER NULL,
  on_hand INT NULL,
  reserved INT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE inventory.movements (
  id BIGINT IDENTITY PRIMARY KEY,
  request_id UNIQUEIDENTIFIER NOT NULL UNIQUE REFERENCES inventory.requests(request_id),
  warehouse_id INT NOT NULL,
  product_id INT NOT NULL,
  action VARCHAR(8) NOT NULL CHECK (action IN ('receive', 'adjust', 'reserve', 'release')),
  quantity INT NOT NULL,
  on_hand_delta INT NOT NULL,
  reserved_delta INT NOT NULL,
  on_hand_after INT NOT NULL,
  reserved_after INT NOT NULL,
  reason NVARCHAR(200) NOT NULL,
  actor_id UNIQUEIDENTIFIER NOT NULL,
  tenant_id UNIQUEIDENTIFIER NOT NULL,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  FOREIGN KEY (warehouse_id, product_id) REFERENCES inventory.stock(warehouse_id, product_id)
);
CREATE INDEX ix_inventory_reservations_warehouse ON inventory.reservations(warehouse_id, created_at DESC);
CREATE INDEX ix_inventory_movements_warehouse ON inventory.movements(warehouse_id, id DESC);
GO
CREATE FUNCTION inventory.actor_id()
RETURNS UNIQUEIDENTIFIER WITH SCHEMABINDING
AS
BEGIN
  DECLARE @claim NVARCHAR(4000) = CONVERT(NVARCHAR(4000), SESSION_CONTEXT(N'http://schemas.microsoft.com/identity/claims/objectidentifier'));
  RETURN CASE WHEN DATALENGTH(@claim) = 72 THEN TRY_CONVERT(UNIQUEIDENTIFIER, @claim) END;
END;
GO
CREATE FUNCTION inventory.tenant_id()
RETURNS UNIQUEIDENTIFIER WITH SCHEMABINDING
AS
BEGIN
  DECLARE @claim NVARCHAR(4000) = CONVERT(NVARCHAR(4000), SESSION_CONTEXT(N'http://schemas.microsoft.com/identity/claims/tenantid'));
  RETURN CASE WHEN DATALENGTH(@claim) = 72 THEN TRY_CONVERT(UNIQUEIDENTIFIER, @claim) END;
END;
GO
CREATE FUNCTION inventory.can_read(@warehouse_id INT)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed
  WHERE EXISTS (SELECT 1 FROM inventory.warehouse_members AS m
    WHERE m.warehouse_id = @warehouse_id
      AND m.tenant_id = inventory.tenant_id() AND m.actor_id = inventory.actor_id());
GO
CREATE FUNCTION inventory.can_write(@warehouse_id INT)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed
  WHERE EXISTS (SELECT 1 FROM inventory.warehouse_members AS m
    WHERE m.warehouse_id = @warehouse_id AND m.role IN ('operator', 'manager')
      AND m.tenant_id = inventory.tenant_id() AND m.actor_id = inventory.actor_id());
GO
CREATE FUNCTION inventory.can_read_receipt(@warehouse_id INT, @tenant_id UNIQUEIDENTIFIER, @actor_id UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed
  WHERE @tenant_id = inventory.tenant_id() AND @actor_id = inventory.actor_id()
    AND EXISTS (SELECT 1 FROM inventory.can_read(@warehouse_id));
GO
CREATE FUNCTION inventory.can_write_receipt(@warehouse_id INT, @tenant_id UNIQUEIDENTIFIER, @actor_id UNIQUEIDENTIFIER)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS allowed
  WHERE @tenant_id = inventory.tenant_id() AND @actor_id = inventory.actor_id()
    AND EXISTS (SELECT 1 FROM inventory.can_write(@warehouse_id));
GO
CREATE SECURITY POLICY inventory.warehouse_isolation
  ADD FILTER PREDICATE inventory.can_read(id) ON inventory.warehouses,
  ADD FILTER PREDICATE inventory.can_read(warehouse_id) ON inventory.stock,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.stock AFTER INSERT,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.stock BEFORE UPDATE,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.stock AFTER UPDATE,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.stock BEFORE DELETE,
  ADD FILTER PREDICATE inventory.can_read(warehouse_id) ON inventory.reservations,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.reservations AFTER INSERT,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.reservations BEFORE UPDATE,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.reservations AFTER UPDATE,
  ADD BLOCK PREDICATE inventory.can_write(warehouse_id) ON inventory.reservations BEFORE DELETE,
  ADD FILTER PREDICATE inventory.can_read(warehouse_id) ON inventory.movements,
  ADD BLOCK PREDICATE inventory.can_write_receipt(warehouse_id, tenant_id, actor_id) ON inventory.movements AFTER INSERT,
  ADD FILTER PREDICATE inventory.can_read_receipt(warehouse_id, tenant_id, actor_id) ON inventory.requests,
  ADD BLOCK PREDICATE inventory.can_write_receipt(warehouse_id, tenant_id, actor_id) ON inventory.requests AFTER INSERT
  WITH (STATE = ON, SCHEMABINDING = ON);
GO
CREATE VIEW inventory.caller_access AS
  SELECT 1 AS id, inventory.tenant_id() AS tenant_id, inventory.actor_id() AS actor_id
  WHERE inventory.tenant_id() IS NOT NULL AND inventory.actor_id() IS NOT NULL;
GO
CREATE VIEW inventory.warehouse_access AS
  SELECT w.id, w.name, m.role FROM inventory.warehouses AS w
  JOIN inventory.warehouse_members AS m ON m.warehouse_id = w.id
  WHERE m.tenant_id = inventory.tenant_id() AND m.actor_id = inventory.actor_id();
GO
CREATE VIEW inventory.availability AS
  SELECT s.warehouse_id, s.product_id, p.name, p.sku, p.category_id,
    s.on_hand, s.reserved, s.on_hand - s.reserved AS available, s.reorder_point,
    CONVERT(BIT, CASE WHEN s.on_hand - s.reserved <= s.reorder_point THEN 1 ELSE 0 END) AS low_stock,
    s.updated_at
  FROM inventory.stock AS s JOIN dbo.products AS p ON p.id = s.product_id;
GO
CREATE VIEW inventory.reservation_details AS
  SELECT r.id, r.warehouse_id, r.product_id, p.name, p.sku, r.quantity, r.status,
    r.actor_id, r.created_at, r.released_at
  FROM inventory.reservations AS r JOIN dbo.products AS p ON p.id = r.product_id;
GO
CREATE VIEW inventory.movement_history AS
  SELECT m.id, m.request_id, m.warehouse_id, m.product_id, p.name, p.sku, m.action,
    m.quantity, m.on_hand_delta, m.reserved_delta, m.on_hand_after, m.reserved_after,
    m.reason, m.actor_id, m.created_at
  FROM inventory.movements AS m JOIN dbo.products AS p ON p.id = m.product_id;
GO
CREATE VIEW inventory.command_receipts AS
  SELECT request_id, warehouse_id, outcome, code, product_id, reservation_id, on_hand, reserved, created_at
  FROM inventory.requests;
