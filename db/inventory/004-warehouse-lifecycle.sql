-- Deleting an empty warehouse must remove its memberships in the same statement as its RLS check.
DECLARE @membership_fk SYSNAME;
SELECT @membership_fk = name FROM sys.foreign_keys
  WHERE parent_object_id = OBJECT_ID(N'inventory.warehouse_members')
    AND referenced_object_id = OBJECT_ID(N'inventory.warehouses');
IF @membership_fk IS NULL
  THROW 51030, 'The warehouse membership foreign key was not found.', 1;
DECLARE @drop_fk NVARCHAR(4000) = N'ALTER TABLE inventory.warehouse_members DROP CONSTRAINT ' + QUOTENAME(@membership_fk);
EXEC sys.sp_executesql @drop_fk;
ALTER TABLE inventory.warehouse_members ADD CONSTRAINT fk_inventory_members_warehouse
  FOREIGN KEY (warehouse_id) REFERENCES inventory.warehouses(id) ON DELETE CASCADE;
