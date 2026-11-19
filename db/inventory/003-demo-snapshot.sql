DECLARE @bootstrap_tenant UNIQUEIDENTIFIER = inventory.tenant_id(),
  @bootstrap_actor UNIQUEIDENTIFIER = inventory.actor_id();
IF @bootstrap_tenant IS NULL OR @bootstrap_actor IS NULL
  THROW 51010, 'Initial inventory setup requires the intended manager tenant and object IDs.', 1;
IF EXISTS (SELECT 1 FROM dbo.products WHERE stock_qty NOT BETWEEN 0 AND 1000000)
  THROW 51011, 'Catalog stock is outside the supported inventory snapshot range.', 1;
INSERT inventory.warehouses(name) VALUES (N'Seattle demo warehouse');
DECLARE @seattle INT = CONVERT(INT, SCOPE_IDENTITY());
INSERT inventory.warehouse_members(warehouse_id, tenant_id, actor_id, role)
  VALUES (@seattle, @bootstrap_tenant, @bootstrap_actor, 'manager');
INSERT inventory.warehouses(name) VALUES (N'Austin demo warehouse');
DECLARE @austin INT = CONVERT(INT, SCOPE_IDENTITY());
INSERT inventory.warehouse_members(warehouse_id, tenant_id, actor_id, role)
  VALUES (@austin, @bootstrap_tenant, @bootstrap_actor, 'manager');
INSERT inventory.stock(warehouse_id, product_id, on_hand)
  SELECT w.id, p.id, p.stock_qty
  FROM inventory.warehouses AS w CROSS JOIN dbo.products AS p
  WHERE w.id IN (@seattle, @austin) AND p.is_active = 1;
