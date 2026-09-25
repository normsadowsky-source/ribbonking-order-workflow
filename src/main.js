const app = document.querySelector('#app');

const statusLabel = {
  PO_REVIEW_REQUIRED: 'PO Review Required',
  READY_FOR_VECTOR: 'Ready for Vector',
  WAITING_CUSTOMER_INFO: 'Waiting for Customer Information',
  WAITING_VECTOR: 'Waiting on Vector',
  VECTOR_REVIEW_REQUIRED: 'Vector Review Required',
  WAITING_CUSTOMER_RESPONSE: 'Waiting for Customer Response',
  WAITING_CUSTOMER_APPROVAL: 'Waiting for Customer Approval',
  CUSTOMER_CHANGES_REQUESTED: 'Customer Changes Requested',
  WAITING_VECTOR_REVISION: 'Waiting on Vector Revision',
  CUSTOMER_APPROVED: 'Customer Approved',
  COMPLETE: 'Complete',
};

const allowedExtensions = new Set(['pdf', 'eps', 'ai', 'rio']);

function fileExtension(name='') {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function validateFiles(files=[]) {
  const bad = files.find(file => !allowedExtensions.has(fileExtension(file.name)));
  return bad ? `Unsupported file type: ${bad.name}. Accepted formats: PDF, EPS, AI, RIO.` : '';
}

function isOverdue(order) {
  if (!order.follow_up_due) return false;
  const today = new Date();
  today.setHours(0,0,0,0);
  return new Date(order.follow_up_due + 'T00:00:00') < today;
}

function tone(order) {
  if (isOverdue(order)) return 'red';
  if (order.status === 'COMPLETE') return 'green';
  if (order.status?.startsWith('WAITING_')) return 'yellow';
  return 'blue';
}

function daysWaiting(order) {
  if (!order.waiting_since) return '—';
  const days = Math.max(0, Math.floor((Date.now() - new Date(order.waiting_since).getTime()) / 86400000));
  return days === 0 ? 'Today' : `${days}d`;
}

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">RK</div>
        <div><strong>Ribbon King</strong><span>Order Workflow</span></div>
      </div>
      <nav class="side-nav">
        <button class="nav-item active" data-filter=""><span>▦</span> Dashboard</button>
        <button class="nav-item" data-filter="Egnali"><span>✓</span> Egnali</button>
        <button class="nav-item" data-filter="Logas"><span>↗</span> Logas</button>
        <button class="nav-item" data-filter="overdue"><span>!</span> Overdue</button>
        <button class="nav-item" data-filter="complete"><span>✓</span> Completed</button>
        <button class="nav-item" data-filter="all"><span>⌕</span> All Orders</button>
      </nav>
      <div class="sidebar-help">
        <strong>Workflow rule</strong>
        <p>Every open PO must always show an owner, status, and next action.</p>
      </div>
    </aside>

    <main class="main-content">
      <header class="page-header">
        <div>
          <div class="eyebrow">Ribbon King Operations</div>
          <h1>Order Dashboard</h1>
          <p>PO intake, Vector workflow, customer approval, and follow-up tracking.</p>
        </div>
        <button id="newOrderBtn" class="primary large">+ Add New Order</button>
      </header>

      <section class="summary" id="summary"></section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 id="listTitle">Open Orders</h2>
            <p>Orders requiring action or monitoring.</p>
          </div>
          <div class="panel-tools">
            <label class="search-box"><span>Search</span><input id="orderSearch" type="search" placeholder="Search by PO number" autocomplete="off" /></label>
            <div class="legend">
              <span><i class="dot blue"></i>Action</span>
              <span><i class="dot yellow"></i>Waiting</span>
              <span><i class="dot red"></i>Overdue</span>
              <span><i class="dot green"></i>Complete</span>
            </div>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>PO</th><th>Company</th><th>Status</th><th>Owner</th><th>Next Action</th><th>Follow-Up</th><th>Waiting</th></tr></thead>
            <tbody id="ordersBody"></tbody>
          </table>
        </div>
      </section>
    </main>
  </div>

  <dialog id="newOrderDialog" class="order-dialog">
    <form method="dialog" id="newOrderForm">
      <div class="dialog-head">
        <div>
          <div class="eyebrow">Step 1 — PO Intake</div>
          <h2>Add New Order</h2>
          <p>Create the PO, attach the original files, then Egnali reviews it.</p>
        </div>
        <button type="button" class="icon" id="closeNew">×</button>
      </div>
      <div class="form-grid">
        <label>Company Name<input name="companyName" required autocomplete="organization" placeholder="Customer / company name" /></label>
        <label>PO Number<input name="poNumber" required autocomplete="off" placeholder="PO number" /></label>
      </div>
      <label class="upload-label">Artwork / PO Files
        <div class="dropzone">
          <div class="upload-icon">↑</div>
          <strong>Select artwork or PO files</strong>
          <span>Accepted formats: PDF, EPS, AI, RIO</span>
          <input id="newOrderFiles" name="files" type="file" multiple accept=".pdf,.eps,.ai,.rio,application/pdf,application/postscript" />
        </div>
      </label>
      <div class="info-strip">The same PO number may be used by different customers. A duplicate warning only appears when both Company Name + PO Number match.</div>
      <p class="error" id="newOrderError"></p>
      <div class="actions"><button type="button" class="secondary" id="cancelNew">Cancel</button><button class="primary" type="submit">Create Order</button></div>
    </form>
  </dialog>

  <dialog id="orderDialog" class="order-dialog detail-dialog"><div id="orderDetail"></div></dialog>
`;

let orders = [];
let selectedOrder = null;
let currentFilter = '';
let searchQuery = '';
let isCreatingOrder = false;

async function loadOrders() {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error('Could not load orders');
  orders = await res.json();
  render();
}

function filteredOrders() {
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    return orders.filter(o => String(o.po_number || '').toLowerCase().includes(q));
  }
  if (currentFilter === 'overdue') return orders.filter(o => o.status !== 'COMPLETE' && isOverdue(o));
  if (currentFilter === 'complete') return orders.filter(o => o.status === 'COMPLETE');
  if (currentFilter === 'all') return orders;
  if (currentFilter === 'Egnali') return orders.filter(o => o.status !== 'COMPLETE' && (o.owner === 'Egnali' || o.status === 'WAITING_CUSTOMER_RESPONSE'));
  if (currentFilter) return orders.filter(o => o.owner === currentFilter && o.status !== 'COMPLETE');
  return orders.filter(o => o.status !== 'COMPLETE');
}

function render() {
  const overdue = orders.filter(isOverdue).length;
  const waiting = orders.filter(o => o.status?.startsWith('WAITING_')).length;
  const logas = orders.filter(o => o.owner === 'Logas' && o.status !== 'COMPLETE').length;
  const egnali = orders.filter(o => o.owner === 'Egnali' && o.status !== 'COMPLETE').length;

  document.querySelector('#summary').innerHTML = [
    ['Needs Attention', overdue, 'red'],
    ['Waiting', waiting, 'yellow'],
    ['Logas Responsibilities', logas, 'blue'],
    ['Egnali Responsibilities', egnali, 'blue']
  ].map(([label,value,color]) => `<article class="summary-card ${color}"><span>${label}</span><strong>${value}</strong></article>`).join('');

  const filtered = filteredOrders();
  document.querySelector('#listTitle').textContent = searchQuery.trim() ? 'Search Results' : currentFilter === 'overdue' ? 'Overdue Orders' : currentFilter === 'complete' ? 'Completed Orders' : currentFilter === 'all' ? 'All Orders' : currentFilter ? currentFilter + ' Responsibilities' : 'Open Orders';

  document.querySelector('#ordersBody').innerHTML = filtered.length ? filtered.map(o => `
    <tr data-id="${o.id}" tabindex="0">
      <td><strong>${escapeHtml(o.po_number)}</strong></td>
      <td>${escapeHtml(o.company_name)}</td>
      <td><span class="pill ${tone(o)}">${isOverdue(o) ? 'Overdue · ' : ''}${statusLabel[o.status] || o.status}</span></td>
      <td><span class="owner-chip">${escapeHtml(o.owner)}</span>${o.status === 'WAITING_CUSTOMER_RESPONSE' ? '<small class="shared-note">Visible to Egnali</small>' : ''}</td>
      <td>${escapeHtml(o.next_action)}</td>
      <td>${o.follow_up_due ? `${escapeHtml(o.follow_up_owner || o.owner)} · ${o.follow_up_due}` : (o.follow_up_owner ? `${escapeHtml(o.follow_up_owner)} · Pending` : '—')}</td>
      <td>${daysWaiting(o)}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">No orders in this view.</td></tr>`;

  document.querySelectorAll('#ordersBody tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openOrder(Number(row.dataset.id)));
    row.addEventListener('keydown', e => { if (e.key === 'Enter') openOrder(Number(row.dataset.id)); });
  });
}

async function openOrder(id) {
  selectedOrder = orders.find(o => Number(o.id) === id);
  const [historyRes, attachmentsRes] = await Promise.all([
    fetch(`/api/order-history?id=${id}`),
    fetch(`/api/order-attachments?orderId=${id}`)
  ]);
  const history = await historyRes.json();
  const attachments = attachmentsRes.ok ? await attachmentsRes.json() : [];
  const detail = document.querySelector('#orderDetail');

  detail.innerHTML = `
    <div class="dialog-head">
      <div>
        <div class="eyebrow">PO ${escapeHtml(selectedOrder.po_number)}</div>
        <h2>${escapeHtml(selectedOrder.company_name)}</h2>
        <p>Complete order workspace</p>
        <button type="button" class="secondary edit-order-btn" id="editOrderBtn">Edit Company / PO</button>
      </div>
      <button class="icon" id="closeOrder">×</button>
    </div>

    <div class="responsibility ${tone(selectedOrder)}">
      <span>Current Responsibility</span>
      <strong>${escapeHtml(selectedOrder.owner)}</strong>
      <em>${escapeHtml(selectedOrder.next_action)}</em>
    </div>

    <div class="meta">
      <div><span>Status</span><strong>${statusLabel[selectedOrder.status] || selectedOrder.status}</strong></div>
      <div><span>Follow-Up</span><strong>${selectedOrder.follow_up_owner ? `${escapeHtml(selectedOrder.follow_up_owner)}${selectedOrder.follow_up_due ? ` · ${selectedOrder.follow_up_due}` : ' · Pending'}` : 'None'}</strong></div>
    </div>

    ${selectedOrder.status === 'WAITING_CUSTOMER_RESPONSE' ? `
      <div class="response-window">
        <strong>3-business-hour customer response window</strong>
        <p><b>Proof sent:</b> ${selectedOrder.waiting_since ? new Date(selectedOrder.waiting_since).toLocaleString() : 'Time not available'}</p>
        <p><b>Visible to:</b> Logas and Egnali. Logas remains the temporary owner, but Egnali may record an approval immediately if she sees the customer's email first.</p>
        <p>If the customer requests changes, Logas continues the revision process. If there is no response after the window, approval follow-up transfers to Egnali.</p>
      </div>` : ''}

    ${selectedOrder.status === 'CUSTOMER_APPROVED' ? `<div class="post-approval"><div><span>Ship Date</span><strong>${selectedOrder.ship_date_sent_at ? 'Sent' : 'Pending'}</strong></div><div><span>Plate</span><strong>${formatPlate(selectedOrder.plate_status)}</strong></div></div>` : ''}

    <section class="attachments">
      <div class="section-head"><div><h3>Artwork & PO Files</h3><p>Permanent files attached to this PO.</p></div></div>
      <div class="attachment-list">${renderAttachments(attachments)}</div>
      <div class="attachment-upload">
        <input id="orderAttachmentInput" type="file" multiple accept=".pdf,.eps,.ai,.rio,application/pdf,application/postscript" />
        <button type="button" class="secondary" id="uploadAttachmentBtn">Attach Files</button>
      </div>
      <p class="file-help">Accepted formats: PDF, EPS, AI, RIO.</p>
      <p class="file-help" id="attachmentStatus"></p>
    </section>

    <section class="workflow-card">
      <div class="section-head"><div><h3>Next Workflow Action</h3><p>Use the button that matches what happened next.</p></div></div>
      <div class="workflow-actions">${actionButtons(selectedOrder)}</div>
      <label class="notes">Notes for this action<textarea id="actionNotes" rows="3" placeholder="Optional notes"></textarea></label>
    </section>

    <section class="history-card">
      <div class="section-head"><div><h3>Activity History</h3><p>Permanent audit trail for this order.</p></div></div>
      <div class="history">${history.map(h => `<div><strong>${formatEvent(h.event_type)}</strong><span>${escapeHtml(h.actor)} · ${new Date(h.created_at).toLocaleString()}</span>${h.notes ? `<p>${escapeHtml(h.notes)}</p>` : ''}</div>`).join('') || '<p>No history yet.</p>'}</div>
    </section>
  `;

  detail.querySelector('#closeOrder').addEventListener('click', () => document.querySelector('#orderDialog').close());
  detail.querySelector('#editOrderBtn').addEventListener('click', () => showEditOrderForm(detail));
  detail.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => runAction(btn.dataset.action)));
  detail.querySelector('#uploadAttachmentBtn').addEventListener('click', async () => {
    const input = detail.querySelector('#orderAttachmentInput');
    const files = Array.from(input.files || []);
    const status = detail.querySelector('#attachmentStatus');
    if (!files.length) { status.textContent = 'Choose at least one file.'; return; }
    const validation = validateFiles(files);
    if (validation) { status.textContent = validation; return; }
    status.textContent = 'Uploading...';
    try {
      for (const file of files) await uploadAttachment(selectedOrder.id, file, selectedOrder.owner || 'Egnali');
      const orderId = selectedOrder.id;
      document.querySelector('#orderDialog').close();
      await loadOrders();
      await openOrder(orderId);
    } catch (error) {
      status.textContent = error.message || 'Could not upload the file.';
    }
  });
  document.querySelector('#orderDialog').showModal();
}

function showEditOrderForm(detail) {
  const existing = detail.querySelector('#editOrderForm');
  if (existing) {
    existing.remove();
    return;
  }

  const form = document.createElement('div');
  form.id = 'editOrderForm';
  form.className = 'edit-order-card';
  form.innerHTML = `
    <div class="section-head"><div><h3>Edit Order Details</h3><p>Correct the company or PO number. The change will be saved in Activity History.</p></div></div>
    <div class="form-grid">
      <label>Company Name<input id="editCompanyName" value="${escapeHtml(selectedOrder.company_name)}" /></label>
      <label>PO Number<input id="editPoNumber" value="${escapeHtml(selectedOrder.po_number)}" /></label>
    </div>
    <p class="error" id="editOrderError"></p>
    <div class="actions">
      <button type="button" class="secondary" id="cancelEditOrder">Cancel</button>
      <button type="button" class="primary" id="saveEditOrder">Save Changes</button>
    </div>
  `;
  detail.querySelector('.meta').before(form);

  form.querySelector('#cancelEditOrder').addEventListener('click', () => form.remove());
  form.querySelector('#saveEditOrder').addEventListener('click', async () => {
    const companyName = form.querySelector('#editCompanyName').value.trim();
    const poNumber = form.querySelector('#editPoNumber').value.trim();
    const errorEl = form.querySelector('#editOrderError');
    const saveBtn = form.querySelector('#saveEditOrder');

    if (!companyName || !poNumber) {
      errorEl.textContent = 'Company name and PO number are required.';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errorEl.textContent = '';

    const res = await fetch('/api/orders', {
      method:'PATCH',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ orderId:selectedOrder.id, companyName, poNumber, actor:'Egnali' })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      errorEl.textContent = data.error || 'Could not update the order.';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
      return;
    }

    const orderId = selectedOrder.id;
    document.querySelector('#orderDialog').close();
    await loadOrders();
    await openOrder(orderId);
  });
}

function actionButtons(order) {
  const status = order.status;
  const map = {
    PO_REVIEW_REQUIRED: [['ASSIGN_TO_LOGAS','PO Complete → Send to Logas'],['WAITING_CUSTOMER_INFO','Missing Info → Send to Logas with Notes']],
    READY_FOR_VECTOR: [['SENT_TO_VECTOR','Send to Vector'],['WAITING_CUSTOMER_INFO','Waiting for Customer Information']],
    WAITING_CUSTOMER_INFO: [['FOLLOW_UP_SENT','Follow-Up Sent'],['SENT_TO_VECTOR','Information Received → Send to Vector']],
    WAITING_VECTOR: [['FOLLOW_UP_SENT','Follow-Up Vector'],['VECTOR_RECEIVED','Vector Artwork Received']],
    VECTOR_REVIEW_REQUIRED: [['PROOF_SENT','Proof Sent to Customer'],['REVISION_SENT_VECTOR','Send Correction to Vector']],
    WAITING_CUSTOMER_RESPONSE: [
      ['CUSTOMER_CHANGES','Customer Requested Changes'],
      ['APPROVED_NO_PLATE_READY','Approved + Ship Date + No Plate → Ready for Production'],
      ['APPROVED_PLATE_REQUIRED','Approved + Ship Date + Plate Required'],
      ['TRANSFER_APPROVAL_TO_EGNALI','No Response After 3 Hours → Egnali']
    ],
    WAITING_CUSTOMER_APPROVAL: [
      ['FOLLOW_UP_SENT','Egnali: Approval Follow-Up Sent'],
      ['CUSTOMER_CHANGES','Customer Requested Changes'],
      ['APPROVED_NO_PLATE_READY','Approved + Ship Date + No Plate → Ready for Production'],
      ['APPROVED_PLATE_REQUIRED','Approved + Ship Date + Plate Required']
    ],
    CUSTOMER_CHANGES_REQUESTED: [['REVISION_SENT_VECTOR','Send Revision to Vector']],
    WAITING_VECTOR_REVISION: [['FOLLOW_UP_SENT','Follow-Up Vector'],['VECTOR_RECEIVED','Revision Received']],
    COMPLETE: [],
  };

  if (status === 'CUSTOMER_APPROVED') {
    if (order.plate_status === 'REQUIRED') {
      return '<button class="secondary" data-action="PLATE_READY_COMPLETE">Plate Ready / Sent → Ready for Production</button>';
    }
    const fallback = [
      ['SHIP_DATE_SENT','Ship Date Sent to Customer'],
      ['PLATE_NOT_REQUIRED','No Plate Required'],
      ['PLATE_REQUIRED','Plate Required'],
      ['COMPLETE','Ready for Production']
    ];
    return fallback.map(([action,label]) => `<button class="secondary" data-action="${action}">${label}</button>`).join('');
  }

  return (map[status] || []).map(([action,label]) => `<button class="secondary" data-action="${action}">${label}</button>`).join('') || '<span class="muted">No further actions.</span>';
}

async function runAction(action) {
  const notes = document.querySelector('#actionNotes')?.value || '';
  const actor = action === 'FOLLOW_UP_SENT' && selectedOrder.follow_up_owner
    ? selectedOrder.follow_up_owner
    : (selectedOrder.status === 'WAITING_CUSTOMER_RESPONSE' && currentFilter === 'Egnali' ? 'Egnali' : selectedOrder.owner);
  const res = await fetch('/api/order-action', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ orderId:selectedOrder.id, action, actor, notes }) });
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

async function uploadAttachment(orderId, file, actor='Egnali') {
  const form = new FormData();
  form.append('orderId', String(orderId));
  form.append('actor', actor);
  form.append('file', file, file.name);
  const res = await fetch('/api/order-attachments', { method:'POST', body:form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Could not upload ${file.name}.`);
  return data;
}

function renderAttachments(items=[]) {
  if (!items.length) return '<p class="muted">No files attached yet.</p>';
  return items.map(a => `
    <a class="attachment-row" href="/api/order-attachment-file?id=${a.id}">
      <span><strong>${escapeHtml(a.file_name)}</strong><small>${escapeHtml(a.uploaded_by)} · ${new Date(a.created_at).toLocaleString()}</small></span>
      <em>${formatBytes(a.file_size)}</em>
    </a>
  `).join('');
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
}
function formatEvent(v='') { return v.toLowerCase().split('_').map(w => w.charAt(0).toUpperCase()+w.slice(1)).join(' '); }
function formatPlate(v='UNDECIDED') { return ({UNDECIDED:'Undecided',NOT_REQUIRED:'Not Required',REQUIRED:'Required',ORDERED:'Ordered'})[v] || v; }

document.querySelector('#newOrderBtn').addEventListener('click', () => document.querySelector('#newOrderDialog').showModal());
document.querySelector('#closeNew').addEventListener('click', () => document.querySelector('#newOrderDialog').close());
document.querySelector('#cancelNew').addEventListener('click', () => document.querySelector('#newOrderDialog').close());

document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
  currentFilter = btn.dataset.filter || '';
  searchQuery = '';
  const search = document.querySelector('#orderSearch');
  if (search) search.value = '';
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}));

document.querySelector('#orderSearch').addEventListener('input', e => {
  searchQuery = e.target.value || '';
  render();
});

document.querySelector('#newOrderForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (isCreatingOrder) return;
  isCreatingOrder = true;
  const form = e.currentTarget;
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }
  const fd = new FormData(form);
  const files = Array.from(document.querySelector('#newOrderFiles').files || []);
  const errorEl = document.querySelector('#newOrderError');
  errorEl.textContent = '';

  const validation = validateFiles(files);
  if (validation) { errorEl.textContent = validation; isCreatingOrder = false; if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Order'; } return; }

  const res = await fetch('/api/orders', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({ poNumber:fd.get('poNumber'), companyName:fd.get('companyName'), actor:'Egnali' })
  });
  const data = await res.json();

  if (res.status === 409 && data.existingOrder) {
    errorEl.textContent = 'This PO already exists for this company. Open the existing order instead.';
    isCreatingOrder = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Order'; }
    return;
  }

  if (!res.ok) {
    const parts = [data.error, data.cause, data.detail, data.hint].filter(Boolean);
    errorEl.textContent = parts.join(' — ') || 'Could not create order.';
    isCreatingOrder = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Order'; }
    return;
  }

  try {
    for (const file of files) await uploadAttachment(data.id, file, 'Egnali');
  } catch (error) {
    errorEl.textContent = `Order created, but a file could not be attached: ${error.message}`;
    await loadOrders();
    isCreatingOrder = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Order'; }
    return;
  }

  form.reset();
  document.querySelector('#newOrderDialog').close();
  await loadOrders();
  await openOrder(Number(data.id));
  isCreatingOrder = false;
  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Order'; }
});

loadOrders().catch(err => {
  document.querySelector('#ordersBody').innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(err.message)}</td></tr>`;
});
