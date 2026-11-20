const sql = require('mssql');

function createConfig(env = process.env) {
  if (env.SQL_CONNECTION_STRING && (env.SQL_SERVER || env.SQL_DATABASE || env.SQL_PORT)) {
    throw new Error('Use SQL_CONNECTION_STRING or separate SQL_SERVER/SQL_DATABASE/SQL_PORT, not both');
  }
  let routing = { server: env.SQL_SERVER, database: env.SQL_DATABASE, port: Number(env.SQL_PORT || 1433) };
  if (env.SQL_CONNECTION_STRING) {
    try {
      routing = sql.ConnectionPool.parseConnectionString(env.SQL_CONNECTION_STRING);
    } catch {
      throw new Error('SQL_CONNECTION_STRING is invalid; use passwordless server/database routing');
    }
  }
  for (const key of ['server', 'database']) {
    if (!routing[key]) throw new Error(`SQL_${key.toUpperCase()} is required; see README.md`);
  }
  if (['user', 'password', 'clientSecret', 'token', 'msiSecret'].some((key) => routing[key])
      || routing.options?.encrypt === false || routing.options?.trustServerCertificate === true) {
    throw new Error('SQL_CONNECTION_STRING must be passwordless routing with verified TLS');
  }
  if (env.SQL_PASSWORD || env.SQL_USER || env.DATABASE_URL || env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Password/URL authentication and TLS overrides are not supported');
  }
  const mode = env.ENTRA_CREDENTIAL || 'managed-identity';
  if (!['managed-identity', 'default'].includes(mode)) {
    throw new Error('ENTRA_CREDENTIAL must be managed-identity or default (local development)');
  }
  const port = routing.port ?? 1433;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SQL_PORT is invalid');
  return {
    server: routing.server,
    database: routing.database,
    port,
    authentication: {
      type: mode === 'managed-identity'
        ? 'azure-active-directory-msi-app-service' : 'azure-active-directory-default',
      options: env.AZURE_CLIENT_ID ? { clientId: env.AZURE_CLIENT_ID } : {},
    },
    connectionTimeout: 60000,
    requestTimeout: 15000,
    pool: { min: 0, max: 5, idleTimeoutMillis: 30000 },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      abortTransactionOnError: true,
      maxRetriesOnTransientErrors: 0,
      appName: 'shopstream-inventory-admin',
      useUTC: true,
    },
  };
}

module.exports = { createConfig };
