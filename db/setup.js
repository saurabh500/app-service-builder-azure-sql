const { readFileSync } = require('node:fs');
const path = require('node:path');
const sql = require('mssql');
const { createConfig } = require('../server/db/config');
const { runTransaction } = require('../server/db/transaction');

const TABLES = ['order_items', 'inventory_events', 'reviews', 'orders', 'products', 'customers', 'categories', 'vendors'];
const source = (name) => readFileSync(path.join(__dirname, name), 'utf8');
const identifier = (value) => '[' + value.replaceAll(']', ']]') + ']';

async function bootstrap(connection, reset = false, env = process.env) {
  if (reset && (!env.SQL_DATABASE || env.SHOPSTREAM_CONFIRM_RESET !== env.SQL_DATABASE)) {
    throw new Error('Set SHOPSTREAM_CONFIRM_RESET to the dedicated SQL_DATABASE name to confirm data replacement');
  }
  const installed = await runTransaction(connection, async (client) => {
    const compatibility = await client.query('SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()');
    const level = compatibility.recordset[0]?.compatibility_level;
    if (!Number.isInteger(level) || level < 160) {
      throw new Error('Database compatibility level must be at least 160; an administrator must update it before bootstrap');
    }
    const exists = await client.query("SELECT OBJECT_ID(N'dbo.shopstream_bootstrap', N'U') AS marker");
    if (!exists.recordset[0].marker) {
      const tables = await client.query('SELECT name FROM sys.tables WHERE is_ms_shipped = 0');
      if (tables.recordset.length) throw new Error('Bootstrap requires an empty dedicated database; existing tables were found');
      await client.query(source('schema.sql'));
      await client.query('CREATE TABLE dbo.shopstream_bootstrap (version INT PRIMARY KEY, seeded_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())');
    }
    const marker = await client.query('SELECT version FROM dbo.shopstream_bootstrap');
    if (exists.recordset[0].marker && !marker.recordset.length) {
      throw new Error('Existing bootstrap marker has no version; refusing to modify an unverified database');
    }
    if (marker.recordset.length && (marker.recordset.length !== 1 || marker.recordset[0].version !== 1)) {
      throw new Error('Unsupported bootstrap version');
    }
    if (marker.recordset.length && !reset) {
      return false;
    }
    if (reset && marker.recordset.length) {
      // Foreign keys prevent TRUNCATE; DELETE and reseed in dependency order.
      for (const table of TABLES) {
        await client.query(`DELETE FROM dbo.${identifier(table)}; DBCC CHECKIDENT ('dbo.${table}', RESEED, 0) WITH NO_INFOMSGS;`);
      }
      await client.query('DELETE FROM dbo.shopstream_bootstrap');
    }
    await client.query(source('seed.sql'));
    await client.query('INSERT INTO dbo.shopstream_bootstrap (version) VALUES (1)');
    return true;
  });
  console.log(installed ? 'Installed schema and bounded seed version 1' : 'Schema and seed version 1 already installed; no data changed');
}

function hasRuntimeMapping(rows, role, oid, type) {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('Unsupported Entra principal metadata');
  if (!rows.length) return false;
  const mapped = rows[0];
  if (!mapped || typeof mapped !== 'object') throw new Error('Unsupported Entra principal metadata');
  if (mapped.name !== role || typeof mapped.object_id !== 'string'
      || mapped.object_id.toLowerCase() !== oid.toLowerCase()
      || mapped.type !== (type === 'group' ? 'X' : 'E')
      || mapped.authentication_type_desc !== 'EXTERNAL') {
    throw new Error('Existing Entra mapping differs; refusing to replace it');
  }
  return true;
}

async function grant(connection, env = process.env) {
  const { RUNTIME_ROLE: role, RUNTIME_OBJECT_ID: oid, RUNTIME_OBJECT_TYPE: type = 'service' } = env;
  if (!role || role.length > 128 || !/^[a-z][a-z0-9_]*$/.test(role) || role === 'dbo' || role === 'guest' || role === 'public') {
    throw new Error('RUNTIME_ROLE must be a separate lowercase database user (at most 128 characters)');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oid || '')
      || !['user', 'service', 'group'].includes(type)) {
    throw new Error('RUNTIME_OBJECT_ID and RUNTIME_OBJECT_TYPE must identify the intended Entra principal');
  }
  await runTransaction(connection, async (client) => {
    const existing = await client.query(`SELECT name, type, authentication_type_desc,
      CONVERT(varchar(36), CONVERT(uniqueidentifier, sid)) AS object_id
      FROM sys.database_principals WHERE name = @p1`, [role]);
    if (!hasRuntimeMapping(existing.recordset, role, oid, type)) {
      const sid = await client.query('SELECT CONVERT(varchar(34), CONVERT(binary(16), CONVERT(uniqueidentifier, @p1)), 1) AS sid', [oid]);
      if (!/^0x[0-9a-f]{32}$/i.test(sid.recordset[0].sid)) throw new Error('Invalid Entra SID conversion');
      await client.query(`CREATE USER ${identifier(role)} WITH SID = ${sid.recordset[0].sid}, TYPE = ${type === 'group' ? 'X' : 'E'}`);
    }
    const privileges = await client.query(`SELECT 1 AS elevated
      WHERE EXISTS (SELECT 1 FROM sys.database_role_members WHERE member_principal_id = DATABASE_PRINCIPAL_ID(@p1))
         OR EXISTS (SELECT 1 FROM sys.schemas WHERE principal_id = DATABASE_PRINCIPAL_ID(@p1))
         OR DATABASE_PRINCIPAL_ID(@p1) = 1
         OR EXISTS (SELECT 1 FROM sys.database_permissions
           WHERE grantee_principal_id = DATABASE_PRINCIPAL_ID(@p1)
             AND NOT (class = 0 AND permission_name = 'CONNECT' AND state = 'G')
             AND (class <> 1 OR permission_name NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')))`, [role]);
    if (privileges.recordset.length) throw new Error('Runtime user must not hold administrator privileges, roles or schema ownership');
    const name = identifier(role);
    for (const table of TABLES) await client.query(`GRANT SELECT ON OBJECT::dbo.${identifier(table)} TO ${name}`);
    for (const table of ['orders', 'order_items', 'reviews', 'inventory_events']) {
      await client.query(`GRANT INSERT ON OBJECT::dbo.${identifier(table)} TO ${name}`);
    }
    await client.query(`GRANT UPDATE ON OBJECT::dbo.products (stock_qty, rating_avg, review_count, updated_at) TO ${name}`);
    await client.query(`GRANT UPDATE ON OBJECT::dbo.orders (status, updated_at) TO ${name}`);
    await client.query(`GRANT DELETE ON OBJECT::dbo.reviews TO ${name}`);
  });
  console.log('Mapped Entra runtime principal and granted only sample runtime operations');
}

async function main() {
  const command = process.argv[2];
  if (!['bootstrap', 'reset', 'grant'].includes(command)) throw new Error('Use bootstrap, reset, or grant');
  if (process.env.ENTRA_CREDENTIAL !== 'default') throw new Error('Administrative setup requires ENTRA_CREDENTIAL=default with a local Entra administrator');
  const config = createConfig();
  const client = new sql.ConnectionPool({ ...config, requestTimeout: 65000 });
  client.on('error', (err) => console.error('Azure SQL setup pool error:', err.code || err.name));
  try {
    await client.connect();
    if (command === 'grant') await grant(client);
    else await bootstrap(client, command === 'reset', { ...process.env, SQL_DATABASE: config.database });
  } finally { await client.close(); }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Database setup failed:', err.code || err.name, err.code ? 'Check identity, grants, TLS, and network access' : err.message);
    process.exitCode = 1;
  });
}
module.exports = { bootstrap, grant, hasRuntimeMapping };
