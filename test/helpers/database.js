const { EventEmitter } = require('node:events');

function fakeConnection(handler = async () => ({ recordset: [] })) {
  const statements = [];
  const calls = [];
  const tx = new EventEmitter();
  tx.begin = async () => { statements.push('BEGIN'); };
  tx.commit = async () => { statements.push('COMMIT'); };
  tx.rollback = async () => { statements.push('ROLLBACK'); tx.emit('rollback'); };
  tx.request = () => {
    const parameters = {};
    return {
      input(name, value) { parameters[name] = value; return this; },
      async query(statement) {
        statements.push(statement);
        calls.push({ statement, parameters });
        return handler(statement, parameters, tx);
      },
    };
  };
  return { transaction: () => tx, request: tx.request, statements, calls, tx };
}

module.exports = { fakeConnection };
