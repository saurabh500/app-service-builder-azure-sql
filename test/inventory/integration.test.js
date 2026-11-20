const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sql = require('mssql');
const { createConfig } = require('../../db/inventory/config');
const { setClaims } = require('../../db/inventory/setup');

test('real inventory RLS, atomic commands, durable idempotency and concurrent last-item reservation',
  { timeout: 240000 }, async () => {
    const config = createConfig();
    assert.equal(process.env.INVENTORY_TEST_CONFIRM_DATABASE, config.database, 'Explicitly confirm the database for isolated inventory verification fixtures');
    const tenant = randomUUID();
    const actors = { manager: randomUUID(), operator: randomUUID(), other: randomUUID(), viewer: randomUUID(), missing: randomUUID() };
    const pools = [];
    const makePool = async (actor, tenantId = tenant) => {
      const pool = new sql.ConnectionPool({ ...config, requestTimeout: 30000, pool: { min: 0, max: 1 } });
      pool.on('error', error => console.error('Inventory test pool error:', error.code || error.name));
      pools.push(pool);
      await pool.connect();
      await setClaims(pool.request(), tenantId, actor);
      return pool;
    };
    const command = async (pool, body) => {
      const request = pool.request()
        .input('request_id', sql.UniqueIdentifier, body.request_id || randomUUID())
        .input('warehouse_id', sql.Int, body.warehouse_id)
        .input('action', sql.VarChar(20), body.action)
        .input('product_id', sql.Int, body.product_id ?? null)
        .input('quantity', sql.Int, body.quantity ?? null)
        .input('reservation_id', sql.UniqueIdentifier, body.reservation_id ?? null)
        .input('reason', sql.NVarChar(sql.MAX), body.reason ?? 'Isolated verification');
      return (await request.execute('inventory.execute_command')).recordset[0];
    };
    let warehouse, otherWarehouse, product, secondProduct;
    let manager;
    try {
      manager = await makePool(actors.manager);
      const products = (await manager.request().query('SELECT TOP (2) id, stock_qty FROM dbo.products WHERE is_active = 1 ORDER BY id')).recordset;
      assert.equal(products.length, 2, 'The block-predicate fixture needs two distinct real product references');
      [product, secondProduct] = products.map(row => row.id);
      for (const [label, actor] of [['A', actors.manager], ['B', actors.other]]) {
        const id = (await manager.request().input('name', sql.NVarChar(80), `Verification ${label} ${tenant}`)
          .query('INSERT inventory.warehouses(name) VALUES (@name); SELECT CONVERT(INT, SCOPE_IDENTITY()) AS id;')).recordset[0].id;
        if (label === 'A') warehouse = id; else otherWarehouse = id;
        await manager.request().input('warehouse', sql.Int, id).input('tenant', sql.UniqueIdentifier, tenant)
          .input('actor', sql.UniqueIdentifier, actor)
          .query("INSERT inventory.warehouse_members VALUES (@warehouse, @tenant, @actor, 'manager')");
        await setClaims(manager.request(), tenant, actor);
        await manager.request().input('warehouse', sql.Int, id).input('product', sql.Int, product)
          .query('INSERT inventory.stock(warehouse_id, product_id, on_hand) VALUES (@warehouse, @product, 1)');
      }
      await setClaims(manager.request(), tenant, actors.manager);
      for (const [actor, role] of [[actors.operator, 'operator'], [actors.viewer, 'viewer']]) {
        await manager.request().input('warehouse', sql.Int, warehouse).input('tenant', sql.UniqueIdentifier, tenant)
          .input('actor', sql.UniqueIdentifier, actor).input('role', sql.VarChar(8), role)
          .query('INSERT inventory.warehouse_members VALUES (@warehouse, @tenant, @actor, @role)');
      }
      const operator = await makePool(actors.operator);
      const other = await makePool(actors.other);
      const viewer = await makePool(actors.viewer);
      const missing = await makePool(actors.missing);
      const wrongTenant = await makePool(actors.manager, randomUUID());
      const balance = async pool => (await pool.request().input('warehouse', sql.Int, warehouse)
        .query('SELECT on_hand, reserved FROM inventory.stock WHERE warehouse_id = @warehouse')).recordset[0];
      const base = { warehouse_id: warehouse, product_id: product };
      assert.deepEqual((await manager.request().query('SELECT id FROM inventory.warehouse_access')).recordset, [{ id: warehouse }]);
      assert.deepEqual((await other.request().query('SELECT id FROM inventory.warehouse_access')).recordset, [{ id: otherWarehouse }]);
      for (const pool of [missing, wrongTenant]) {
        assert.equal((await pool.request().query('SELECT * FROM inventory.availability')).recordset.length, 0);
      }
      await setClaims(missing.request(), null, null);
      assert.equal((await missing.request().query('SELECT * FROM inventory.availability')).recordset.length, 0);
      await setClaims(missing.request(), tenant, actors.manager + 'suffix');
      assert.equal((await missing.request().query('SELECT * FROM inventory.availability')).recordset.length, 0, 'Malformed GUID prefixes must not become valid actors');
      assert.equal((await command(viewer, { ...base, action: 'receive', quantity: 1 })).code, 'access_denied');
      assert.equal((await command(other, { ...base, action: 'receive', quantity: 1 })).code, 'access_denied');
      assert.equal((await command(operator, { ...base, action: 'adjust', quantity: 1 })).code, 'access_denied');
      assert.deepEqual(await balance(manager), { on_hand: 1, reserved: 0 });
      const sessionIds = await Promise.all([manager, operator].map(async pool =>
        (await pool.request().query('SELECT @@SPID AS id')).recordset[0].id));
      assert.notEqual(sessionIds[0], sessionIds[1], 'The last-item test must use two real SQL sessions');

      const lastItem = await Promise.all([command(manager, { ...base, action: 'reserve', quantity: 1 }),
        command(operator, { ...base, action: 'reserve', quantity: 1 })]);
      assert.equal(lastItem.filter(row => row.outcome === 'applied').length, 1);
      assert.equal(lastItem.filter(row => row.code === 'insufficient_stock').length, 1);
      assert.deepEqual(await balance(manager), { on_hand: 1, reserved: 1 });
      const reservation = lastItem.find(row => row.outcome === 'applied').reservation_id;
      const release = { warehouse_id: warehouse, action: 'release', reservation_id: reservation, request_id: randomUUID() };
      assert.equal((await command(operator, release)).outcome, 'applied');
      assert.equal((await command(operator, release)).outcome, 'applied');
      assert.deepEqual(await balance(manager), { on_hand: 1, reserved: 0 });
      assert.equal((await command(operator, { ...release, request_id: randomUUID() })).code, 'reservation_not_active');
      const receive = { ...base, action: 'receive', quantity: 2, request_id: randomUUID() };
      const twice = await Promise.all([command(manager, receive), command(manager, receive)]);
      assert.equal(twice[0].outcome, 'applied');
      assert.deepEqual(twice[1], twice[0]);
      assert.deepEqual(await balance(manager), { on_hand: 3, reserved: 0 });
      assert.equal((await command(manager, { ...receive, quantity: 3 })).code, 'request_id_conflict');
      assert.equal((await command(manager, { ...base, action: 'adjust', quantity: -4, reason: 'Too much' })).code, 'stock_limit');
      assert.equal((await command(manager, { ...base, action: 'adjust', quantity: -1, reason: 'Verified recount' })).outcome, 'applied');
      assert.deepEqual(await balance(manager), { on_hand: 2, reserved: 0 });

      const duplicateElsewhere = randomUUID();
      assert.equal((await command(other, { warehouse_id: otherWarehouse, product_id: product,
        action: 'receive', quantity: 1, request_id: duplicateElsewhere })).outcome, 'applied');
      await assert.rejects(command(manager, { ...base, action: 'receive', quantity: 9, request_id: duplicateElsewhere }),
        error => error.number === 2627);
      assert.deepEqual(await balance(manager), { on_hand: 2, reserved: 0 }, 'The receipt insert fails after balance update: both must roll back');
      const blocked = await manager.request().input('warehouse', sql.Int, otherWarehouse).input('product', sql.Int, secondProduct)
        .query('SELECT COUNT(*) AS count FROM inventory.stock WHERE warehouse_id=@warehouse AND product_id=@product');
      assert.equal(blocked.recordset[0].count, 0);
      assert.equal((await other.request().input('product', sql.Int, secondProduct)
        .query('SELECT COUNT(*) AS count FROM inventory.stock WHERE product_id=@product')).recordset[0].count, 0,
      'The block-predicate insert must not fail merely because its key already exists');
      await assert.rejects(manager.request().input('warehouse', sql.Int, otherWarehouse).input('product', sql.Int, secondProduct)
        .query('INSERT inventory.stock(warehouse_id, product_id, on_hand) VALUES (@warehouse,@product,1)'),
      error => error.number === 33504);
      assert.equal((await other.request().input('product', sql.Int, secondProduct)
        .query('SELECT COUNT(*) AS count FROM inventory.stock WHERE product_id=@product')).recordset[0].count, 0);
      await manager.request().input('warehouse', sql.Int, warehouse)
        .query('UPDATE inventory.stock SET on_hand=990000 WHERE warehouse_id=@warehouse');
      assert.equal((await command(manager, { ...base, action: 'receive', quantity: 10000 })).outcome, 'applied');
      for (let index = 0; index < 2; index++) {
        assert.equal((await command(manager, { ...base, action: 'receive', quantity: 1 })).code, 'stock_limit');
      }
      assert.equal((await balance(manager)).on_hand, 1000000);
      assert.deepEqual((await manager.request().query(`SELECT TOP (2) id, stock_qty FROM dbo.products WHERE is_active = 1 ORDER BY id`)).recordset, products);
      console.log('Verified real SQL: scoped/missing/malformed claims, viewer/operator denial, one last-item winner, duplicate command/release, payload conflict, rollback, block predicate, repeated cap, and unchanged catalog rows.');
    } finally {
      try {
      if (warehouse) {
        await setClaims(manager.request(), tenant, actors.manager);
        for (const id of [warehouse, otherWarehouse].filter(Boolean)) {
          await manager.request().input('warehouse', sql.Int, id).input('tenant', sql.UniqueIdentifier, tenant)
          .input('actor', sql.UniqueIdentifier, actors.manager)
          .query("IF NOT EXISTS (SELECT 1 FROM inventory.warehouse_members WHERE warehouse_id=@warehouse AND tenant_id=@tenant AND actor_id=@actor) INSERT inventory.warehouse_members VALUES (@warehouse,@tenant,@actor,'manager')");
        }
        for (const table of ['movements', 'reservations']) {
          await manager.request().input('a', sql.Int, warehouse).input('b', sql.Int, otherWarehouse || warehouse)
            .query(`DELETE inventory.${table} WHERE warehouse_id IN (@a,@b)`);
        }
        for (const actor of Object.values(actors)) {
          await setClaims(manager.request(), tenant, actor);
          await manager.request().input('a', sql.Int, warehouse).input('b', sql.Int, otherWarehouse || warehouse)
            .query('DELETE inventory.requests WHERE warehouse_id IN (@a,@b)');
        }
        await setClaims(manager.request(), tenant, actors.manager);
        await manager.request().input('a', sql.Int, warehouse).input('b', sql.Int, otherWarehouse || warehouse)
          .query('DELETE inventory.stock WHERE warehouse_id IN (@a,@b); DELETE inventory.warehouses WHERE id IN (@a,@b)');
      }
      } finally {
        await Promise.all(pools.map(pool => pool.close()));
      }
    }
  });
