const sql = require('mssql');
const { createConfig } = require('./config');

let pool;

async function connect() {
  if (!pool) {
    pool = new sql.ConnectionPool(createConfig());
    pool.on('error', (err) => {
      console.error('Azure SQL pool error:', err.code || err.name);
    });
  }
  return pool.connect();
}

async function query(statement, parameters = [], executor) {
  const request = (executor || await connect()).request();
  parameters.forEach((value, index) => request.input(`p${index + 1}`, value));
  return request.query(statement);
}

async function close() {
  if (pool) await pool.close();
  pool = undefined;
}

module.exports = { connect, query, close };
