const app = document.querySelector('#app');

const statusLabel = {
  PO_REVIEW_REQUIRED: 'PO Review Required',
  READY_FOR_VECTOR: 'Ready for Vector',
  WAITING_CUSTOMER_INFO: 'Waiting for Customer Info',
  WAITING_VECTOR: 'Waiting on Vector',
  VECTOR_REVIEW_REQUIRED: 'Vector Review Required',
  WAITING_CUSTOMER_APPROVAL: 'Waiting for Customer Approval',
  CUSTOMER_CHANGES_REQUESTED: 'Customer Changes Requested',
  WAITING_VECTOR_REVISION: 'Waiting on Vector Revision',
  CUSTOMER_APPROVED: 'Customer Approved',
  COMPLETE: 'Complete',
};

function isOverdue(order) {
  if (!order.follow_up_due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(order.follow_up_due + 'T00:00:00') < today;
}

function tone(order) {
  if (isOverdue(order)) return 'red';
  if (order.status.startsWith('WAITING_')) return 'yellow';
  if (order.status === 'COMPLETE') return 'green';
  return 'blue';
}

function daysWaiting(order) {
  if (!order.waiting_since) return '—';
  return Math.max(0, Math.floor((Date.now() - new Date(order.waiting_since).getTime()) / 86400000)) + 'd';
}

app.innerHTML = `
  <header class="topbar">
    <div>
      <div class="eyebrow">Ribbon King</div>
      <h1>Order Workflow</h1>
      <p>Responsibility, follow-ups, and proof progress in one place.</p>
    </div>
    <button id="newOrderBtn" class="primary">+ New Order</button>
  </header>

  <section class="summary" id="summary"></section>

  <section class="panel">
    <div class="panel-head">
      <div><h2>Open Orders</h2><p>Orders requiring action or monitoring.</p></div>
      <label class="filter">Owner
        <select id="ownerFilter"><option value="">Everyone</option><option>Egnali</option><option>Logas</option></select>
      </label>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>PO</th><th>Company</th><th>Status</th><th>Owner</th><th>Next Action</th><th>Follow-Up</th><th>Waiting</th></tr></thead>
        <tbody id="ordersBody"></tbody>
      </table>
    </div>
  </section>

  <dialog id="newOrderDialog">
    <form method="dialog" id="newOrderForm">
      <div class="dialog-head"><h2>New Order</h2><button type="button" class="icon" id="closeNew">×</button></div>
      <label>PO Number<input name="poNumber" required autocomplete="off" /></label>
      <label>Company Name<input name="companyName" required autocomplete="organization" /></label>
      <p class="error" id="newOrderError"></p>
      <div class="actions"><button type="button" class="secondary" id="cancelNew">Cancel</button><button class="primary" type="submit">Create Order</button></div>
    </form>
  </dialog>

  <dialog id="orderDialog"><div id="orderDetail"></div></dialog>
`;

let orders = [];
let selectedOrder = null;

async function loadOrders() {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error('Could not load orders');
  orders = await res.json();
  render();
}

function render() {
  const owner = document.querySelector('#ownerFilter').value;
  const filtered = owner ? orders.filter(o => o.owner === owner) : orders;
  const overdue = orders.filter(isOverdue).length;
  const waiting = orders.filter(o => o.status.startsWith('WAITING_')).length;
  const logas = orders.filter(o => o.owner === 'Logas' && o.status !== 'COMPLETE').length;
  const egnali = orders.filter(o => o.owner === 'Egnali' && o.status !== 'COMPLETE').length;
  document.querySelector('#summary').innerHTML = [
    ['Needs Attention', overdue], ['Waiting', waiting], ['Logas', logas], ['Egnali', egnali]
  ].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join('');

  document.querySelector('#ordersBody').innerHTML = filtered.length ? filtered.map(o => `
    <tr data-id="${o.id}" tabindex="0">
      <td><strong>${escapeHtml(o.po_number)}</strong></td>
      <td>${escapeHtml(o.company_name)}</td>
      <td><span class="pill ${tone(o)}">${isOverdue(o) ? 'Overdue · ' : ''}${statusLabel[o.status] || o.status}</span></td>
      <td>${escapeHtml(o.owner)}</td>
      <td>${escapeHtml(o.next_action)}</td>
      <td>${o.follow_up_due ? `${escapeHtml(o.follow_up_owner || o.owner)} · ${o.follow_up_due}` : (o.follow_up_owner ? `${escapeHtml(o.follow_up_owner)} · Pending` : '—')}</td>
      <td>${daysWaiting(o)}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">No orders yet.</td></tr>`;

  document.querySelectorAll('#ordersBody tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openOrder(Number(row.dataset.id)));
    row.addEventListener('keydown', e => { if (e.key === 'Enter') openOrder(Number(row.dataset.id)); });
  });
}

async function openOrder(id) {
  selectedOrder = orders.find(o => Number(o.id) === id);
  const historyRes = await fetch(`/api/order-history?id=${id}`);
  const history = await historyRes.json();
  const detail = document.querySelector('#orderDetail');
  detail.innerHTML = `
    <div class="dialog-head"><div><div class="eyebrow">PO ${escapeHtml(selectedOrder.po_number)}</div><h2>${escapeHtml(selectedOrder.company_name)}</h2></div><button class="icon" id="closeOrder">×</button></div>
    <div class="responsibility ${tone(selectedOrder)}"><span>Current Responsibility</span><strong>${escapeHtml(selectedOrder.owner)}</strong><em>${escapeHtml(selectedOrder.next_action)}</em></div>
    <div class="meta"><div><span>Status</span><strong>${statusLabel[selectedOrder.status] || selectedOrder.status}</strong></div><div><span>Follow-Up</span><strong>${selectedOrder.follow_up_owner ? `${escapeHtml(selectedOrder.follow_up_owner)}${selectedOrder.follow_up_due ? ` · ${selectedOrder.follow_up_due}` : ' · Pending'}` : 'None'}</strong></div></div>
    ${selectedOrder.status === 'CUSTOMER_APPROVED' ? `<div class="post-approval"><div><span>Ship Date</span><strong>${selectedOrder.ship_date_sent_at ? 'Sent' : 'Pending'}</strong></div><div><span>Plate</span><strong>${formatPlate(selectedOrder.plate_status)}</strong></div></div>` : ''}
    <h3>Move Order</h3>
    <div class="workflow-actions">${actionButtons(selectedOrder.status)}</div>
    <label class="notes">Notes for this action<textarea id="actionNotes" rows="3" placeholder="Optional"></textarea></label>
    <h3>Activity</h3>
    <div class="history">${history.map(h => `<div><strong>${formatEvent(h.event_type)}</strong><span>${escapeHtml(h.actor)} · ${new Date(h.created_at).toLocaleString()}</span>${h.notes ? `<p>${escapeHtml(h.notes)}</p>` : ''}</div>`).join('') || '<p>No history yet.</p>'}</div>
  `;
  detail.querySelector('#closeOrder').addEventListener('click', () => document.querySelector('#orderDialog').close());
  detail.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => runAction(btn.dataset.action)));
  document.querySelector('#orderDialog').showModal();
}

function actionButtons(status) {
  const map = {
    PO_REVIEW_REQUIRED: [['ASSIGN_TO_LOGAS','PO Complete → Assign to Logas'],['WAITING_CUSTOMER_INFO','Missing Info → Assign/Monitor']],
    READY_FOR_VECTOR: [['SENT_TO_VECTOR','Sent to Vector'],['WAITING_CUSTOMER_INFO','Waiting for Customer Info']],
    WAITING_CUSTOMER_INFO: [['FOLLOW_UP_SENT','Follow-Up Sent'],['SENT_TO_VECTOR','Info Received → Sent to Vector']],
    WAITING_VECTOR: [['FOLLOW_UP_SENT','Follow-Up Vector'],['VECTOR_RECEIVED','Vector Received']],
    VECTOR_REVIEW_REQUIRED: [['PROOF_SENT','Proof Sent to Customer'],['REVISION_SENT_VECTOR','Correction Sent to Vector']],
    WAITING_CUSTOMER_APPROVAL: [['FOLLOW_UP_SENT','Egnali: Approval Follow-Up Sent'],['CUSTOMER_CHANGES','Customer Requested Changes'],['CUSTOMER_APPROVED','Customer Approved']],
    CUSTOMER_CHANGES_REQUESTED: [['REVISION_SENT_VECTOR','Revision Sent to Vector']],
    WAITING_VECTOR_REVISION: [['FOLLOW_UP_SENT','Follow-Up Vector'],['VECTOR_RECEIVED','Revision Received']],
    CUSTOMER_APPROVED: [['SHIP_DATE_SENT','Ship Date Sent to Customer'],['PLATE_NOT_REQUIRED','No Plate Required'],['PLATE_REQUIRED','Plate Required'],['PLATE_ORDERED','Plate Ordered'],['COMPLETE','Close Order']],
    COMPLETE: [],
  };
  return (map[status] || []).map(([action,label]) => `<button class="secondary" data-action="${action}">${label}</button>`).join('') || '<span class="muted">No further actions.</span>';
}

async function runAction(action) {
  const notes = document.querySelector('#actionNotes')?.value || '';
  const res = await fetch('/api/order-action', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ orderId:selectedOrder.id, action, actor: action === 'FOLLOW_UP_SENT' && selectedOrder.follow_up_owner ? selectedOrder.follow_up_owner : selectedOrder.owner, notes }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let error = document.querySelector('#actionError');
    if (!error) {
      error = document.createElement('p');
      error.id = 'actionError';
      error.className = 'error';
      document.querySelector('.workflow-actions')?.after(error);
    }
    error.textContent = data.error || 'Could not update the order.';
    return;
  }
  document.querySelector('#orderDialog').close();
  await loadOrders();
}

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c])); }
function formatEvent(v='') { return v.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function formatPlate(v='UNDECIDED') { return ({UNDECIDED:'Undecided',NOT_REQUIRED:'Not Required',REQUIRED:'Required',ORDERED:'Ordered'})[v] || v; }

document.querySelector('#newOrderBtn').addEventListener('click', () => document.querySelector('#newOrderDialog').showModal());
document.querySelector('#closeNew').addEventListener('click', () => document.querySelector('#newOrderDialog').close());
document.querySelector('#cancelNew').addEventListener('click', () => document.querySelector('#newOrderDialog').close());
document.querySelector('#ownerFilter').addEventListener('change', render);
document.querySelector('#newOrderForm').addEventListener('submit', async e => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const res = await fetch('/api/orders', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ poNumber:fd.get('poNumber'), companyName:fd.get('companyName'), actor:'Egnali' }) });
  const data = await res.json();
  if (!res.ok) { const parts = [data.error, data.cause, data.detail, data.hint].filter(Boolean); document.querySelector('#newOrderError').textContent = parts.join(' — ') || 'Could not create order.'; return; }
  e.currentTarget.reset();
  document.querySelector('#newOrderDialog').close();
  await loadOrders();
});

loadOrders().catch(err => {
  document.querySelector('#ordersBody').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}. Run this app through Netlify so the database functions are available.</td></tr>`;
});
