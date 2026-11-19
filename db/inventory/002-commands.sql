CREATE PROCEDURE inventory.execute_command
  @request_id UNIQUEIDENTIFIER,
  @warehouse_id INT,
  @action VARCHAR(20),
  @product_id INT = NULL,
  @quantity INT = NULL,
  @reservation_id UNIQUEIDENTIFIER = NULL,
  @reason NVARCHAR(MAX) = N''
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @tenant UNIQUEIDENTIFIER = inventory.tenant_id(), @actor UNIQUEIDENTIFIER = inventory.actor_id();
  DECLARE @outcome VARCHAR(12) = 'rejected', @code VARCHAR(40) = 'invalid_request',
    @on_hand INT, @reserved INT, @old_on_hand INT, @old_reserved INT,
    @result_reservation UNIQUEIDENTIFIER, @role VARCHAR(8), @lock_result INT,
    @existing_hash BINARY(32), @existing_actor UNIQUEIDENTIFIER, @existing_tenant UNIQUEIDENTIFIER;
  DECLARE @payload NVARCHAR(MAX) = (SELECT @warehouse_id AS warehouse_id, @action AS action,
    @product_id AS product_id, @quantity AS quantity, @reservation_id AS reservation_id, @reason AS reason
    FOR JSON PATH, INCLUDE_NULL_VALUES, WITHOUT_ARRAY_WRAPPER);
  DECLARE @hash BINARY(32) = HASHBYTES('SHA2_256', @payload);
  IF @tenant IS NULL OR @actor IS NULL OR @request_id IS NULL
    SET @code = 'identity_required';
  ELSE
  BEGIN
    SELECT @role = role FROM inventory.warehouse_members
      WHERE warehouse_id = @warehouse_id AND tenant_id = @tenant AND actor_id = @actor;
    IF @role IS NULL OR @role = 'viewer' OR (@action = 'adjust' AND @role <> 'manager')
      SET @code = 'access_denied';
    ELSE IF @action IS NULL OR DATALENGTH(@action) NOT IN (6, 7)
      OR @action COLLATE Latin1_General_100_BIN2 NOT IN ('receive', 'adjust', 'reserve', 'release')
      OR @reason IS NULL OR DATALENGTH(@reason) > 400
      OR (@action = 'adjust' AND LEN(LTRIM(RTRIM(@reason))) = 0)
      OR (@action <> 'release' AND (@product_id IS NULL OR @quantity IS NULL OR @quantity = 0 OR @quantity NOT BETWEEN -10000 AND 10000))
      OR (@action IN ('receive', 'reserve') AND @quantity < 1)
      OR (@action = 'release' AND (@reservation_id IS NULL OR @product_id IS NOT NULL OR @quantity IS NOT NULL))
      OR (@action <> 'release' AND @reservation_id IS NOT NULL)
      SET @code = 'invalid_request';
    ELSE
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @lock_name NVARCHAR(255) = N'inventory-request/' + CONVERT(NVARCHAR(36), @request_id);
      EXEC @lock_result = sys.sp_getapplock @Resource = @lock_name, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 10000 WITH RESULT SETS NONE;
      IF @lock_result < 0 THROW 51000, 'The inventory request lock could not be acquired.', 1;
      SET @role = NULL;
      SELECT @role = role FROM inventory.warehouse_members WITH (HOLDLOCK)
        WHERE warehouse_id = @warehouse_id AND tenant_id = @tenant AND actor_id = @actor;
      IF @role IS NULL OR @role = 'viewer' OR (@action = 'adjust' AND @role <> 'manager')
        THROW 51003, 'Warehouse permissions changed; no operation was applied.', 1;
      SELECT @existing_hash = payload_hash, @outcome = outcome, @code = code,
        @on_hand = on_hand, @reserved = reserved, @result_reservation = reservation_id,
        @existing_actor = actor_id, @existing_tenant = tenant_id
      FROM inventory.requests WHERE request_id = @request_id;
      IF @existing_hash IS NOT NULL
      BEGIN
        IF @existing_hash <> @hash OR @existing_actor <> @actor OR @existing_tenant <> @tenant
        BEGIN
          SET @outcome = 'rejected'; SET @code = 'request_id_conflict';
          SET @on_hand = NULL; SET @reserved = NULL; SET @result_reservation = NULL;
        END;
      END
      ELSE
      BEGIN
        DECLARE @target_product INT = @product_id, @target_quantity INT = @quantity;
        IF @action = 'release'
        BEGIN
          SELECT @target_product = product_id, @target_quantity = quantity
          FROM inventory.reservations WITH (UPDLOCK, HOLDLOCK)
          WHERE id = @reservation_id AND warehouse_id = @warehouse_id AND status = 'reserved';
        END;
        SELECT @old_on_hand = on_hand, @old_reserved = reserved
          FROM inventory.stock WITH (UPDLOCK, HOLDLOCK)
          WHERE warehouse_id = @warehouse_id AND product_id = @target_product;
        SET @outcome = 'rejected';
        SET @code = CASE WHEN @action = 'release' AND @target_product IS NULL THEN 'reservation_not_active'
          WHEN @old_on_hand IS NULL THEN 'stock_not_found'
          WHEN @action = 'reserve' AND @old_on_hand - @old_reserved < @target_quantity THEN 'insufficient_stock'
          WHEN @action IN ('receive', 'adjust') AND @old_on_hand + @target_quantity NOT BETWEEN @old_reserved AND 1000000 THEN 'stock_limit'
          ELSE 'applied' END;
        IF @code = 'applied'
        BEGIN
          UPDATE inventory.stock SET
            on_hand = on_hand + CASE WHEN @action IN ('receive', 'adjust') THEN @target_quantity ELSE 0 END,
            reserved = reserved + CASE WHEN @action = 'reserve' THEN @target_quantity
              WHEN @action = 'release' THEN -@target_quantity ELSE 0 END,
            updated_at = SYSUTCDATETIME()
          WHERE warehouse_id = @warehouse_id AND product_id = @target_product;
          IF @@ROWCOUNT <> 1 THROW 51001, 'The inventory balance changed unexpectedly.', 1;
          SET @outcome = 'applied';
          IF @action = 'reserve'
          BEGIN
            SET @result_reservation = @request_id;
            INSERT inventory.reservations(id, warehouse_id, product_id, quantity, status, actor_id, tenant_id)
              VALUES (@request_id, @warehouse_id, @target_product, @target_quantity, 'reserved', @actor, @tenant);
          END;
          IF @action = 'release'
          BEGIN
            SET @result_reservation = @reservation_id;
            UPDATE inventory.reservations SET status = 'released', released_at = SYSUTCDATETIME()
              WHERE id = @reservation_id AND warehouse_id = @warehouse_id AND status = 'reserved';
            IF @@ROWCOUNT <> 1 THROW 51002, 'The reservation changed unexpectedly.', 1;
          END;
        END;
        SELECT @on_hand = on_hand, @reserved = reserved FROM inventory.stock
          WHERE warehouse_id = @warehouse_id AND product_id = @target_product;
        INSERT inventory.requests(request_id, warehouse_id, tenant_id, actor_id, payload_hash,
          outcome, code, product_id, reservation_id, on_hand, reserved)
        VALUES (@request_id, @warehouse_id, @tenant, @actor, @hash, @outcome, @code,
          @target_product, @result_reservation, @on_hand, @reserved);
        IF @outcome = 'applied'
          INSERT inventory.movements(request_id, warehouse_id, product_id, action, quantity,
            on_hand_delta, reserved_delta, on_hand_after, reserved_after, reason, actor_id, tenant_id)
          VALUES (@request_id, @warehouse_id, @target_product, @action, @target_quantity,
            @on_hand - @old_on_hand, @reserved - @old_reserved, @on_hand, @reserved, @reason, @actor, @tenant);
      END;
      COMMIT;
    END TRY
    BEGIN CATCH
      IF XACT_STATE() <> 0 ROLLBACK;
      THROW;
    END CATCH;
  END;
  SELECT @request_id AS request_id, @warehouse_id AS warehouse_id, @outcome AS outcome, @code AS code,
    @result_reservation AS reservation_id, @on_hand AS on_hand, @reserved AS reserved;
END;
