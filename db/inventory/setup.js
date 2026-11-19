const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sql = require('mssql');
const { createConfig } = require('../../server/db/config');
const { hasRuntimeMapping } = require('../setup');

const TENANT_CLAIM = 'http://schemas.microsoft.com/identity/claims/tenantid';
const ACTOR_CLAIM = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const READ_VIEWS = ['caller_access', 'warehouse_access', 'availability', 'reservation_details', 'movement_history', 'command_receipts'];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function identity(value, label) {
  if (!GUID.test(value || '') || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)) {
    throw new Error(`${label} must be a nonzero tenant/object/client GUID`);
  }
  return value;
}

function migrations(directory = __dirname) {
  return fs.readdirSync(directory).filter(name => /^\d{3}-[a-z-]+\.sql$/.test(name)).sort().map((name, index) => {
    const version = Number(name.slice(0, 3));
    if (version !== index + 1) throw new Error('Inventory migration versions must be consecutive, starting at 001');
    const text = fs.readFileSync(path.join(directory, name), 'utf8').replaceAll('\r\n', '\n');
    return { version, name, checksum: createHash('sha256').update(text).digest(), batches: text.split(/^\s*GO\s*$/m).filter(batch => batch.trim()) };
  });
}

async function setClaims(request, tenant, actor) {
  await request.input('tenant_key', sql.NVarChar(128), TENANT_CLAIM)
    .input('actor_key', sql.NVarChar(128), ACTOR_CLAIM)
    .input('tenant_value', sql.NVarChar(4000), tenant)
    .input('actor_value', sql.NVarChar(4000), actor)
    .query('EXEC sys.sp_set_session_context @tenant_key, @tenant_value; EXEC sys.sp_set_session_context @actor_key, @actor_value;');
}

async function migrate(pool, env = process.env) {
  const tenant = identity(env.INVENTORY_TENANT_ID, 'INVENTORY_TENANT_ID');
  const actor = identity(env.INVENTORY_MANAGER_OBJECT_ID, 'INVENTORY_MANAGER_OBJECT_ID');
  const scripts = migrations();
  const tx = pool.transaction();
  let rolledBack = false;
  tx.on('rollback', () => { rolledBack = true; });
  await tx.begin();
  try {
    await tx.request().query(`
      DECLARE @result INT;
      EXEC @result = sys.sp_getapplock @Resource = N'shopstream-inventory-migrations',
        @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
      IF @result < 0 THROW 51020, 'Inventory migration lock unavailable.', 1;
      IF SCHEMA_ID(N'inventory') IS NOT NULL AND OBJECT_ID(N'inventory.schema_migrations', N'U') IS NULL
        AND EXISTS (SELECT 1 FROM sys.objects WHERE schema_id = SCHEMA_ID(N'inventory'))
        THROW 51021, 'Existing inventory objects have no migration ledger; refusing to replace them.', 1;
      IF SCHEMA_ID(N'inventory') IS NULL EXEC(N'CREATE SCHEMA inventory AUTHORIZATION dbo;');
      IF (SELECT principal_id FROM sys.schemas WHERE name = N'inventory') <> DATABASE_PRINCIPAL_ID(N'dbo')
        THROW 51022, 'The inventory schema must be administrator-owned.', 1;
      IF OBJECT_ID(N'inventory.schema_migrations', N'U') IS NULL
        CREATE TABLE inventory.schema_migrations (
          version INT PRIMARY KEY, name NVARCHAR(128) NOT NULL, checksum BINARY(32) NOT NULL,
          applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
    `);
    const installed = (await tx.request().query('SELECT version, name, checksum FROM inventory.schema_migrations ORDER BY version')).recordset;
    for (const [index, row] of installed.entries()) {
      const script = scripts[index];
      if (!script || row.version !== script.version || row.name !== script.name || !Buffer.isBuffer(row.checksum) || !row.checksum.equals(script.checksum)) {
        throw new Error('Installed inventory migrations differ from source; create a new migration instead of editing history');
      }
    }
    await setClaims(tx.request(), tenant, actor);
    for (const script of scripts.slice(installed.length)) {
      for (const [index, batch] of script.batches.entries()) {
        try {
          await tx.request().batch(batch);
        } catch (error) {
          console.error(`Inventory migration ${script.name}, batch ${index + 1} failed`);
          throw error;
        }
      }
      await tx.request().input('version', sql.Int, script.version).input('name', sql.NVarChar(128), script.name)
        .input('checksum', sql.Binary(32), script.checksum)
        .query('INSERT inventory.schema_migrations(version, name, checksum) VALUES (@version, @name, @checksum)');
      console.log(`Applied inventory migration ${script.name}`);
    }
    await setClaims(tx.request(), null, null);
    await tx.commit();
    console.log(installed.length === scripts.length ? 'Inventory schema already current; no rows changed' : 'Inventory migrations committed; original catalog data unchanged');
  } catch (error) {
    if (!rolledBack) {
      try { await tx.rollback(); } catch (rollbackError) {
        console.error('Inventory migration rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    throw error;
  }
}

async function grant(pool, writes, env = process.env) {
  const role = env.RUNTIME_ROLE;
  if (!role || role.length > 128 || !/^[a-z][a-z0-9_]*$/.test(role) || ['dbo', 'guest', 'public'].includes(role)) {
    throw new Error('RUNTIME_ROLE must identify the separate DAB database user');
  }
  const clientId = identity(env.RUNTIME_CLIENT_ID, 'RUNTIME_CLIENT_ID');
  const existing = (await pool.request().input('name', sql.NVarChar(128), role).query(`
    SELECT name, type, authentication_type_desc, CONVERT(VARCHAR(36), CONVERT(UNIQUEIDENTIFIER, sid)) AS sid_id
    FROM sys.database_principals WHERE name = @name;
  `)).recordset;
  if (!hasRuntimeMapping(existing, role, clientId, 'service')) throw new Error('Provision the exact DAB external principal before granting inventory access');
  const elevated = await pool.request().input('name', sql.NVarChar(128), role).query(`
    SELECT 1 AS elevated WHERE EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id = DATABASE_PRINCIPAL_ID(@name))
      OR EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = DATABASE_PRINCIPAL_ID(@name))
      OR EXISTS (SELECT 1 FROM sys.database_permissions WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(@name)
        AND NOT (class = 0 AND permission_name = 'CONNECT' AND state = 'G')
        AND NOT (class = 1 AND state = 'G' AND minor_id = 0 AND (
          (permission_name = 'SELECT' AND major_id IN (
            OBJECT_ID(N'dbo.products'), OBJECT_ID(N'dbo.categories'),
            OBJECT_ID(N'inventory.caller_access'), OBJECT_ID(N'inventory.warehouse_access'),
            OBJECT_ID(N'inventory.availability'), OBJECT_ID(N'inventory.reservation_details'),
            OBJECT_ID(N'inventory.movement_history'), OBJECT_ID(N'inventory.command_receipts')))
          OR (permission_name = 'EXECUTE' AND major_id = OBJECT_ID(N'inventory.execute_command'))
        )));
  `);
  if (elevated.recordset.length) throw new Error('DAB runtime must not own schemas, hold database roles or have broader permissions');
  const name = `[${role}]`;
  for (const view of READ_VIEWS) await pool.request().query(`GRANT SELECT ON OBJECT::inventory.[${view}] TO ${name}`);
  if (writes) {
    await pool.request().query(`GRANT EXECUTE ON OBJECT::inventory.execute_command TO ${name}`);
  }
  console.log(writes ? 'Granted inventory view reads and execution of the single bounded command procedure' : 'Granted inventory view reads only; command execution unchanged');
}

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'grant-read', 'grant-write'].includes(command)) throw new Error('Use migrate, grant-read or grant-write');
  if (process.env.ENTRA_CREDENTIAL !== 'default') throw new Error('Inventory administration requires ENTRA_CREDENTIAL=default');
  const config = createConfig();
  if (process.env.INVENTORY_CONFIRM_DATABASE !== config.database) throw new Error('Set INVENTORY_CONFIRM_DATABASE to the intended SQL_DATABASE before modifying inventory schema or grants');
  const pool = new sql.ConnectionPool({ ...config, requestTimeout: 120000 });
  pool.on('error', error => console.error('Inventory administration pool error:', error.code || error.name));
  try {
    await pool.connect();
    if (command === 'migrate') await migrate(pool);
    else await grant(pool, command === 'grant-write');
  } finally { await pool.close(); }
}

if (require.main === module) main().catch(error => {
  for (const cause of [...(error.precedingErrors || []), error]) {
    console.error('Inventory administration failed:', cause.code || cause.name, cause.message);
  }
  process.exitCode = 1;
});

module.exports = { migrations, identity, setClaims, migrate, grant, TENANT_CLAIM, ACTOR_CLAIM };
