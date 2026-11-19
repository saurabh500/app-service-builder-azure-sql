import React, { useEffect, useMemo, useRef, useState } from 'react';
import { checkReceipt, createCommand, formatSqlUtc, loadAccess, loadInventory, outcomes, pendingKey, restorePending, sendCommand } from './inventory.mjs';

const signed = value => value > 0 ? `+${value}` : value;

export default function Inventory() {
  const [access, setAccess] = useState(null);
  const [warehouse, setWarehouse] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [trackingError, setTrackingError] = useState('');
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [visible, setVisible] = useState(50);
  const [action, setAction] = useState('receive');
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    loadAccess(controller.signal).then(info => {
      if (controller.signal.aborted) return;
      setAccess(info);
      let saved;
      try {
        saved = restorePending(sessionStorage, info.caller);
        pendingRef.current = saved;
        setPending(saved);
      } catch (failure) { setTrackingError(failure.message); }
      setWarehouse(String(info.warehouses.find(row => row.id === saved?.warehouse_id)?.id || info.warehouses[0]?.id || ''));
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!warehouse) return;
    const controller = new AbortController();
    setData(null);
    setError('');
    loadInventory(Number(warehouse), controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [warehouse, refresh]);

  const selected = access?.warehouses.find(row => row.id === Number(warehouse));
  const canWrite = ['operator', 'manager'].includes(selected?.role);
  const rows = useMemo(() => (data?.stock || []).filter(row =>
    (!lowOnly || row.low_stock) && [row.name, row.sku].some(value =>
      String(value || '').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))), [data, lowOnly, search]);
  const totals = data?.stock.reduce((sum, row) => ({
    onHand: sum.onHand + row.on_hand, reserved: sum.reserved + row.reserved,
    available: sum.available + row.available, low: sum.low + Number(row.low_stock),
  }), { onHand: 0, reserved: 0, available: 0, low: 0 });

  const finish = result => {
    sessionStorage.removeItem(pendingKey(access.caller));
    pendingRef.current = null;
    setPending(null);
    setNotice({ applied: result.outcome === 'applied', text: outcomes[result.code] || `Operation ${result.outcome}: ${result.code}`, id: result.request_id });
    setRefresh(value => value + 1);
  };
  const submit = async command => {
    if (sending.current || pendingRef.current) return;
    try {
      sessionStorage.setItem(pendingKey(access.caller), JSON.stringify(command));
    } catch (failure) {
      setTrackingError(`Cannot safely track the request: ${failure.message}. No write was sent.`);
      return;
    }
    pendingRef.current = command;
    setPending(command);
    sending.current = true;
    setBusy(true);
    setNotice(null);
    try { finish(await sendCommand(command, access.caller)); }
    catch (failure) { setNotice({ applied: false, text: `Outcome not confirmed. ${failure.message}`, id: command.request_id }); }
    finally { sending.current = false; setBusy(false); }
  };
  const reconcile = async retry => {
    if (sending.current || !pendingRef.current) return;
    const command = pendingRef.current;
    sending.current = true;
    setBusy(true);
    try {
      if (retry) await sendCommand(command, access.caller);
      const result = await checkReceipt(command, access.caller);
      if (result) finish(result);
      else setNotice({ applied: false, text: 'No accessible receipt yet. The original request may still be running, may not have reached SQL, or your access changed. Do not start it again with a new reference.', id: command.request_id });
    } catch (failure) { setNotice({ applied: false, text: `Original outcome is still unconfirmed. ${failure.message}`, id: command.request_id }); }
    finally { sending.current = false; setBusy(false); }
  };
  const operation = values => {
    try { void submit(createCommand(values)); }
    catch (failure) { setNotice({ applied: false, text: failure.message }); }
  };

  return <section id="inventory" className="inventory-section" aria-labelledby="inventory-title">
    <div className="section-heading"><div><p className="eyebrow">INVENTORY &amp; FULFILLMENT</p><h2 id="inventory-title">Warehouse control center</h2></div>
      <button className="text-button" disabled={!warehouse || busy} onClick={() => setRefresh(value => value + 1)}>Refresh balances</button></div>
    <p className="inventory-intro">Warehouse balances are a separate demo snapshot. These operations never change the original ShopStream catalog stock.</p>
    {notice && <div className={`operation-notice ${notice.applied ? 'operation-applied' : ''}`} role="status"><strong>{notice.text}</strong>
      {notice.id && <p>Request reference: <code>{notice.id}</code></p>}</div>}
    {trackingError && <p className="operation-notice" role="alert">Writes disabled: {trackingError}</p>}
    {pending && <div className="operation-notice" role="alert"><h3>Resolve the saved request before another write</h3>
      <p><code>{pending.request_id}</code> · {pending.action} · warehouse {pending.warehouse_id}. It is preserved across page refreshes for your signed-in account.</p>
      <div className="message-actions"><button className="secondary-button" disabled={busy} onClick={() => void reconcile(false)}>Check original outcome</button>
        <button className="secondary-button" disabled={busy || !canWrite || !!trackingError} onClick={() => void reconcile(true)}>Retry the same request</button></div>
      <p>No write is retried automatically. Retrying here keeps the original request ID and payload.</p></div>}
    {error && <div className="message-panel error-panel" role="alert"><h3>Inventory needs attention</h3><p>{error}</p>
      <a href="/.auth/login/aad?post_login_redirect_uri=%2F%23inventory">Sign in again</a></div>}
    {!access && !error && <div className="message-panel" role="status">Checking your signed-in warehouse access…</div>}
    {access && !access.warehouses.length && <div className="message-panel"><h3>No warehouse assigned</h3><p>An administrator must add your tenant and object ID to a warehouse membership. Catalog browsing remains available.</p></div>}
    {!!access?.warehouses.length && <>
      <div className="inventory-toolbar"><label>Warehouse<select value={warehouse} disabled={busy || !!pending}
        onChange={event => { setWarehouse(event.target.value); setProduct(''); setAction('receive'); setQuantity('1'); setReason(''); setVisible(50); }}>
        {access.warehouses.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <span className="role-label">Your SQL role: <strong>{selected?.role}</strong></span></div>
      {!data && !error && <div className="message-panel" role="status">Reading warehouse balances and recent activity…</div>}
      {data && <>
        <div className="inventory-metrics">{[['On hand', totals.onHand], ['Reserved', totals.reserved], ['Available', totals.available], ['Low-stock SKUs', totals.low]].map(([label, count]) =>
          <div key={label}><span>{label}</span><strong>{count.toLocaleString()}</strong></div>)}</div>
        <div className="inventory-workbench">
          <form className="inventory-form" onSubmit={event => { event.preventDefault(); operation({ warehouse: Number(warehouse), action, product: Number(product), quantity: Number(quantity), reason }); }}>
            <h3>Record an operation</h3><p>{canWrite ? 'SQL checks your role and applies stock, reservation and audit changes in one transaction.' : 'Viewer access: balances and history only.'}</p>
            <fieldset disabled={!canWrite || busy || !!pending || !!trackingError}>
              <label>Operation<select value={action} onChange={event => setAction(event.target.value)}>
                <option value="receive">Receive stock</option><option value="reserve">Reserve stock</option>
                {selected?.role === 'manager' && <option value="adjust">Adjust stock (signed change)</option>}</select></label>
              <label>Product<select value={product} required onChange={event => setProduct(event.target.value)}><option value="">Choose a product</option>
                {data.stock.map(row => <option key={row.product_id} value={row.product_id}>{row.sku} · {row.name} ({row.available} available)</option>)}</select></label>
              <label>Quantity<input type="number" step="1" min={action === 'adjust' ? '-10000' : '1'} max="10000" required value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
              <label>Reason {action !== 'adjust' && '(optional)'}<input type="text" maxLength="200" required={action === 'adjust'} value={reason} onChange={event => setReason(event.target.value)} /></label>
              <button className="primary-button" type="submit">{busy ? 'Recording…' : 'Record operation'}</button>
            </fieldset>
          </form>
          <div className="inventory-balances"><h3>Availability</h3><div className="inventory-filters">
            <label>Find a product<input type="search" value={search} placeholder="Name or SKU" onChange={event => { setSearch(event.target.value); setVisible(50); }} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={lowOnly} onChange={event => { setLowOnly(event.target.checked); setVisible(50); }} />Low stock only</label></div>
            <div className="inventory-table"><table><caption className="sr-only">Stock in {selected?.name}</caption><thead><tr><th>Product</th><th>On hand</th><th>Reserved</th><th>Available</th></tr></thead>
              <tbody>{rows.slice(0, visible).map(row => <tr key={row.product_id}><td><strong>{row.name}</strong><small>{row.sku}{row.low_stock ? ' · Low stock' : ''}</small></td>
                <td>{row.on_hand}</td><td>{row.reserved}</td><td>{row.available}</td></tr>)}</tbody></table></div>
            {!rows.length && <p>No matching products.</p>}
            <p className="results-summary">Showing {Math.min(visible, rows.length)} of {rows.length} matching balances.</p>
            {visible < rows.length && <button className="secondary-button" onClick={() => setVisible(value => value + 50)}>Show 50 more</button>}
          </div>
        </div>
        <div className="inventory-activity"><div><h3>Active reservations</h3><p>Latest 100, newest first. Release returns reserved units to availability.</p>
          <div className="inventory-table"><table><thead><tr><th>Product / reference</th><th>Units</th><th>Action</th></tr></thead><tbody>
            {data.reservations.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.quantity}</td><td>
              <button className="text-button" disabled={!canWrite || busy || !!pending || !!trackingError}
                onClick={() => operation({ warehouse: Number(warehouse), action: 'release', reservation: row.id, reason: 'Released from control center' })}>Release</button></td></tr>)}
          </tbody></table></div>{!data.reservations.length && <p>No active reservations.</p>}</div>
          <div><h3>Movement history</h3><p>Latest 100. Actor references are Entra object IDs.</p>
            <div className="inventory-table"><table><thead><tr><th>Movement</th><th>On hand Δ</th><th>Reserved Δ</th><th>After (on hand / reserved)</th></tr></thead><tbody>
              {data.movements.map(row => <tr key={row.id}><td><strong>{row.action} · {row.name}</strong><small>{formatSqlUtc(row.created_at)} · actor {row.actor_id}</small><small>{row.reason || 'No reason supplied'}</small></td>
                <td>{signed(row.on_hand_delta)}</td><td>{signed(row.reserved_delta)}</td><td>{row.on_hand_after} / {row.reserved_after}</td></tr>)}
            </tbody></table></div>{!data.movements.length && <p>No recorded movements yet. Starting balances came from the initial migration.</p>}</div></div>
      </>}
    </>}
  </section>;
}
