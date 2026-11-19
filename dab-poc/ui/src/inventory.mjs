import { readAll, readPage } from './catalog.mjs';

const guid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const positiveInt = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const path = (resource, parameters) => resource + '?' + new URLSearchParams(parameters);

// DAB omits the offset on SQL DATETIME2 values, but these columns contain UTC.
export const formatSqlUtc = value => new Date(/(Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString();

async function readCaller(signal) {
  const callers = await readAll('/api/access', { '$first': '1' }, signal);
  if (callers.length !== 1 || !guid(callers[0].tenant_id) || !guid(callers[0].actor_id)) {
    throw new Error('SQL did not receive a valid signed-in identity. Inventory operations are unavailable.');
  }
  return callers[0];
}

export async function loadAccess(signal) {
  const [caller, warehouses] = await Promise.all([
    readCaller(signal),
    readAll('/api/warehouses', { '$first': '100', '$orderby': 'id asc' }, signal),
  ]);
  if (warehouses.some(row => !positiveInt(row.id) || !['viewer', 'operator', 'manager'].includes(row.role))) {
    throw new Error('The API returned invalid warehouse access information.');
  }
  return { caller, warehouses };
}

export async function loadInventory(warehouse, signal) {
  if (!positiveInt(warehouse)) throw new Error('Choose a valid warehouse.');
  const filter = `warehouse_id eq ${warehouse}`;
  const [stock, reservations, movements] = await Promise.all([
    readAll('/api/availability', { '$first': '100', '$filter': filter, '$orderby': 'product_id asc' }, signal),
    readPage(path('/api/reservations', { '$first': '100', '$filter': `${filter} and status eq 'reserved'`, '$orderby': 'created_at desc,id asc' }), signal),
    readPage(path('/api/movements', { '$first': '100', '$filter': filter, '$orderby': 'id desc' }), signal),
  ]);
  if ([...stock, ...reservations.value, ...movements.value].some(row => row.warehouse_id !== warehouse)) {
    throw new Error('The API returned rows outside the selected warehouse. Loading stopped.');
  }
  return { stock, reservations: reservations.value, movements: movements.value };
}

export function createCommand({ warehouse, action, product, quantity, reservation, reason = '' }) {
  const command = {
    request_id: crypto.randomUUID(), warehouse_id: warehouse, action,
    product_id: action === 'release' ? null : product,
    quantity: action === 'release' ? null : quantity,
    reservation_id: action === 'release' ? reservation : null, reason,
  };
  validateCommand(command);
  return command;
}

function validateCommand(command) {
  const { request_id, warehouse_id, action, product_id, quantity, reservation_id, reason } = command || {};
  const fields = ['request_id', 'warehouse_id', 'action', 'product_id', 'quantity', 'reservation_id', 'reason'];
  if (!guid(request_id) || !positiveInt(warehouse_id) || !['receive', 'adjust', 'reserve', 'release'].includes(action)
    || Object.keys(command).length !== fields.length || Object.keys(command).some(key => !fields.includes(key))) {
    throw new Error('Choose a warehouse and a supported operation.');
  }
  if (typeof reason !== 'string' || reason.length > 200 || (action === 'adjust' && !reason.trim())) {
    throw new Error('Adjustments need a reason. Reasons must be at most 200 characters.');
  }
  if (action === 'release' ? !guid(reservation_id) || product_id !== null || quantity !== null
    : reservation_id !== null || !positiveInt(product_id) || !Number.isInteger(quantity) || quantity === 0 || Math.abs(quantity) > 10000
      || (action !== 'adjust' && quantity < 1)) {
    throw new Error('Use a valid product and a whole quantity from 1 to 10,000 (negative only for adjustments).');
  }
}

export function pendingKey(caller) {
  if (!guid(caller?.tenant_id) || !guid(caller?.actor_id)) throw new Error('A signed-in inventory identity is required.');
  return `inventory-pending:${caller.tenant_id.toLowerCase()}:${caller.actor_id.toLowerCase()}`;
}

export function restorePending(storage, caller) {
  const text = storage.getItem(pendingKey(caller));
  if (text == null) return null;
  const command = JSON.parse(text);
  validateCommand(command);
  return command;
}

function receipt(row, command) {
  if (!row || !guid(row.request_id) || row.request_id.toLowerCase() !== command.request_id.toLowerCase()
    || row.warehouse_id !== command.warehouse_id || !['applied', 'rejected'].includes(row.outcome)
    || typeof row.code !== 'string'
    || (row.outcome === 'applied' && (!Number.isInteger(row.on_hand) || !Number.isInteger(row.reserved)
      || row.reserved < 0 || row.on_hand < row.reserved))) {
    throw new Error('The API returned an invalid command receipt. Keep the original request reference.');
  }
  return row;
}

async function checkCaller(expected) {
  const key = pendingKey(expected);
  if (pendingKey(await readCaller()) !== key) {
    throw new Error('Your signed-in account changed. Reload the page before continuing; no command was sent.');
  }
}

export async function sendCommand(command, caller) {
  validateCommand(command);
  await checkCaller(caller);
  const response = await fetch('/api/commands', {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Inventory-Command': '1' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Command response was HTTP ${response.status}. Check the saved request before trying another operation.`);
  const page = await response.json();
  if (!Array.isArray(page?.value) || page.value.length !== 1) throw new Error('No single command receipt was returned. Check the saved request.');
  return receipt(page.value[0], command);
}

export async function checkReceipt(command, caller) {
  if (!guid(command?.request_id)) throw new Error('A valid request reference is required.');
  await checkCaller(caller);
  const rows = await readAll('/api/receipts', {
    '$first': '1', '$filter': `request_id eq ${command.request_id}`,
  });
  if (!rows.length) return null;
  if (rows.length !== 1) throw new Error('Multiple command receipts were returned; no new write was sent.');
  return receipt(rows[0], command);
}

export const outcomes = {
  applied: 'Operation applied.',
  access_denied: 'Your warehouse role does not allow this operation.',
  identity_required: 'The database did not receive a valid signed-in identity.',
  invalid_request: 'Check the operation, quantity and reason.',
  insufficient_stock: 'Not enough available stock. Another reservation may have won the last item.',
  stock_limit: 'The change would put stock below reservations or above the 1,000,000-unit ceiling.',
  reservation_not_active: 'This reservation is missing or has already been released.',
  stock_not_found: 'No warehouse balance exists for this product.',
  request_id_conflict: 'This request reference was already used with different details.',
};
