const pool = require('./pool');

const DEMO_LOCK = `
  SET LOCK_TIMEOUT 5000;
  DECLARE @lockResult int;
  EXEC @lockResult = sys.sp_getapplock
    @Resource = N'shopstream-demo', @LockMode = 'Exclusive',
    @LockOwner = 'Transaction', @LockTimeout = 5000;
  IF @lockResult < 0 THROW 51000, 'Demo mutation lock unavailable', 1;
`;

async function runTransaction(connection, action) {
  const tx = connection.transaction();
  let rolledBack = false;
  tx.on('rollback', () => { rolledBack = true; });
  await tx.begin();
  const client = { query: (statement, parameters) => pool.query(statement, parameters, tx) };
  try {
    await client.query(DEMO_LOCK);
    const result = await action(client);
    await tx.commit();
    return result;
  } catch (err) {
    if (!rolledBack) {
      try { await tx.rollback(); } catch (rollbackError) {
        console.error('Azure SQL rollback failed:', rollbackError.code || rollbackError.name);
      }
    }
    throw err;
  }
}

async function transaction(action) {
  return runTransaction(await pool.connect(), action);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = { transaction, runTransaction, httpError };
