<script>
const state = { token: localStorage.getItem('expense_session') || '', user: null, bootstrap: null, myRows: [], workOrders: [], adminData: null, dispatchData: null };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = value => 'NT$ ' + Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindEvents();
  $('#expenseDate').value = new Date().toLocaleDateString('en-CA');
  try {
    state.bootstrap = await gas('getEmployeeExpenseBootstrap');
    $('#appTitle').textContent = state.bootstrap.appName;
    if (state.token) {
      try {
        state.user = await gas('getAuthenticatedEmployeeUser', state.token);
        localStorage.setItem('expense_user', JSON.stringify(state.user));
        enterApp();
      } catch (e) {
        clearSession();
        showLogin();
      }
    } else showLogin();
  } catch (e) {
    showLogin();
    toast(errorText(e), true);
  } finally { setLoading(false); }
}

function bindEvents() {
  bindDispatchEvents();
  $('#loginForm').addEventListener('submit', handleLogin);
  $('#logoutBtn').addEventListener('click', () => {
    clearSession();
    window.top.location.href = 'https://anwing0529.github.io/engineering-expense-erp/';
  });
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#openExpenseBtn').addEventListener('click', () => $('#expenseDialog').showModal());
  $$('.close-dialog').forEach(btn => btn.addEventListener('click', () => $('#expenseDialog').close()));
  $('#expenseForm').addEventListener('submit', submitExpense);
  $('#expenseProject').addEventListener('change', toggleCustomProject);
  $('#receiptInput').addEventListener('change', previewReceipt);
  $('#refreshMineBtn').addEventListener('click', loadMine);
  $('#refreshWorkOrdersBtn').addEventListener('click', loadWorkOrders);
  $('#employeeWorkOrderList').addEventListener('click', e => {
    const card = e.target.closest('[data-task-id]');
    if (card) openWorkReport(card.dataset.taskId);
  });
  $$('.close-work-report').forEach(btn => btn.addEventListener('click', () => $('#workReportDialog').close()));
  $('#workReportForm').addEventListener('submit', submitWorkReport);
  $('#completionPhotoInput').addEventListener('change', previewCompletionPhotos);
  $('#workReportReceiptInput').addEventListener('change', previewWorkReportReceipt);
  $('#adminKeyword').addEventListener('input', debounce(loadAdmin, 350));
  $('#adminMonth').addEventListener('change', loadAdmin);
  $('#clearFiltersBtn').addEventListener('click', () => { $('#adminKeyword').value = ''; $('#adminMonth').value = ''; loadAdmin(); });
  $$('.export-btn').forEach(btn => btn.addEventListener('click', () => exportReport(btn.dataset.format)));
}

async function handleLogin(e) {
  e.preventDefault(); setLoading(true);
  try {
    const result = await gas('employeeLoginWithPin', $('#loginEmail').value, $('#loginPin').value);
    state.token = result.token; state.user = result.user;
    localStorage.setItem('expense_session', state.token);
    localStorage.setItem('expense_user', JSON.stringify(state.user));
    enterApp();
  } catch (err) { toast(errorText(err), true); }
  finally { setLoading(false); }
}

function enterApp() {
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#userName').textContent = state.user.name;
  state.user.role = String(state.user.role || 'EMPLOYEE').toUpperCase();
  const isAdmin = state.user.role === 'ADMIN';
  $('#dispatchNav').classList.toggle('hidden', !isAdmin);
  $('#adminNav').classList.toggle('hidden', !isAdmin);
  fillProjectSelect();
  fillSelect($('#expenseCategory'), state.bootstrap.categories, '請選擇類別');
  if (isAdmin) switchView('dispatch');
  else switchView('employee');
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function clearSession() { state.token = ''; localStorage.removeItem('expense_session'); localStorage.removeItem('expense_user'); }
function switchView(view) {
  if (['admin', 'dispatch'].includes(view) && state.user.role !== 'ADMIN') return;
  $$('.view').forEach(x => x.classList.add('hidden'));
  $('#' + view + 'View').classList.remove('hidden');
  $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  if (view === 'admin') loadAdmin();
  if (view === 'dispatch') loadDispatch();
  if (view === 'employee') {
    loadMine();
    if (state.user.role === 'EMPLOYEE') loadWorkOrders();
    else renderAdminWorkOrderNotice();
  }
}

async function loadWorkOrders() {
  if (!state.user || state.user.role !== 'EMPLOYEE') return renderAdminWorkOrderNotice();
  try {
    state.workOrders = await gas('getMyDispatchWorkOrders', state.token);
    renderWorkOrders();
  } catch (e) {
    $('#employeeWorkOrderList').innerHTML = '<div class="empty error-empty">工單載入失敗：' + escapeHtml(errorText(e)) + '</div>';
    toast(errorText(e), true);
  }
}

function renderAdminWorkOrderNotice() {
  $('#employeeWorkOrderList').innerHTML = '<div class="empty">目前使用 ADMIN 管理者身分；請到「派工管理」查看全部工單。</div>';
}

function renderWorkOrders() {
  const box = $('#employeeWorkOrderList');
  if (!state.workOrders.length) {
    box.innerHTML = '<div class="empty">目前沒有指派給您的工單，請聯絡管理者進行派工。</div>';
    return;
  }
  box.innerHTML = state.workOrders.map(task => {
    const completed = new Set((task.reports || []).flatMap(report => report.completedItemIds || []));
    const total = task.workItems.length;
    const done = task.workItems.filter(item => completed.has(item.id)).length;
    return '<button type="button" class="employee-work-order-card" data-task-id="' + escapeHtml(task.id) + '">' +
      '<div class="work-order-card-head"><div><small>' + escapeHtml(task.id) + '</small><h4>' + escapeHtml(task.name) + '</h4></div><span class="chip">' + escapeHtml(task.status) + '</span></div>' +
      '<p class="work-order-address"><span class="material-symbols-rounded">location_on</span>' + escapeHtml(task.address) + '</p>' +
      '<div class="work-order-progress"><div><span style="width:' + (total ? done / total * 100 : 0) + '%"></span></div><small>' + done + ' / ' + total + ' 項完成</small></div>' +
      '<div class="work-order-card-foot"><span>預定 ' + escapeHtml(task.scheduledDate) + '</span><strong>進入工單 <span class="material-symbols-rounded">arrow_forward</span></strong></div></button>';
  }).join('');
}

function openWorkReport(taskId) {
  const task = state.workOrders.find(row => row.id === taskId);
  if (!task) return toast('找不到工單資料，請重新整理。', true);
  const form = $('#workReportForm');
  form.reset();
  $('#workReportTaskId').value = task.id;
  $('#workReportTaskCode').textContent = task.id + '・預定 ' + task.scheduledDate;
  $('#workReportTaskName').textContent = task.name;
  const address = $('#workReportAddress');
  address.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(task.address);
  address.innerHTML = '<span class="material-symbols-rounded">location_on</span>' + escapeHtml(task.address);
  const completed = new Set((task.reports || []).flatMap(report => report.completedItemIds || []));
  $('#workReportItems').innerHTML = task.workItems.map((item, index) => {
    const done = completed.has(item.id);
    return '<label class="report-work-item' + (done ? ' completed' : '') + '"><input type="checkbox" value="' + escapeHtml(item.id) + '" ' + (done ? 'checked disabled' : '') + '><span class="report-item-number">' + (index + 1) + '</span><span>' + escapeHtml(item.content) + '</span><small>' + (done ? '已回報完成' : '完成後勾選') + '</small></label>';
  }).join('');
  resetPhotoPreview();
  $('#workReportReceiptPreview').classList.add('hidden');
  $('#workReportDialog').showModal();
}

async function submitWorkReport(e) {
  e.preventDefault();
  const button = $('#submitWorkReportBtn');
  button.disabled = true; button.textContent = '送出中…';
  try {
    const receiptFile = $('#workReportReceiptInput').files[0];
    const payload = {
      taskId: $('#workReportTaskId').value,
      completedItemIds: $$('#workReportItems input:checked:not(:disabled)').map(input => input.value),
      materialAmount: $('#workReportMaterialAmount').value,
      note: $('#workReportNote').value.trim(),
      receipt: receiptFile ? { data: await fileBase64(receiptFile), mimeType: receiptFile.type, name: receiptFile.name } : null
    };
    const result = await gas('submitDispatchWorkReport', payload, state.token);
    toast(result.message);
    $('#workReportDialog').close();
    await Promise.all([loadWorkOrders(), loadMine()]);
  } catch (err) { toast(errorText(err), true); }
  finally { button.disabled = false; button.textContent = '送出工單回報'; }
}

function previewCompletionPhotos(e) {
  const files = [...e.target.files].filter(file => file.type.startsWith('image/')).slice(0, 8);
  const box = $('#completionPhotoPreview');
  box.innerHTML = files.length ? files.map(file => '<figure><img src="' + URL.createObjectURL(file) + '" alt="完工照片預覽"><figcaption>' + escapeHtml(file.name) + '</figcaption></figure>').join('') : photoPreviewPlaceholder();
}

function previewWorkReportReceipt(e) {
  const file = e.target.files[0], box = $('#workReportReceiptPreview');
  if (!file) return box.classList.add('hidden');
  if (file.size > 8 * 1024 * 1024) { e.target.value = ''; return toast('收據不可超過 8MB。', true); }
  box.classList.remove('hidden');
  box.innerHTML = file.type.startsWith('image/') ? '<img src="' + URL.createObjectURL(file) + '" alt="材料收據預覽">' : '<span>' + escapeHtml(file.name) + '</span>';
}

function resetPhotoPreview() {
  $('#completionPhotoPreview').innerHTML = photoPreviewPlaceholder();
}

function photoPreviewPlaceholder() {
  return '<div class="photo-preview-placeholder"><span class="material-symbols-rounded">add_photo_alternate</span><span>選擇照片後在此預覽</span></div>';
}
async function loadMine() {
  try {
    state.myRows = await gas('getEmployeeExpenses', state.token);
    renderMine();
  } catch (e) { toast(errorText(e), true); }
}

function renderMine() {
  $('#myTotal').textContent = money(state.myRows.reduce((s, r) => s + r.amount, 0));
  $('#myCount').textContent = state.myRows.length;
  const empty = '<tr><td colspan="7" class="empty">尚無報帳紀錄</td></tr>';
  $('#myExpenseTable').innerHTML = state.myRows.length ? state.myRows.map(r => `<tr>
    <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.project)}</td><td>${escapeHtml(r.item)}</td>
    <td>${escapeHtml(r.category)}</td><td class="right">${money(r.amount)}</td>
    <td>${receiptLink(r)}</td><td><span class="chip">${escapeHtml(r.status)}</span></td></tr>`).join('') : empty;
  $('#myExpenseList').innerHTML = state.myRows.length ? state.myRows.map(expenseCard).join('') : '<div class="empty">尚無報帳紀錄</div>';
}

async function submitExpense(e) {
  e.preventDefault();
  const button = $('#submitExpenseBtn'); button.disabled = true; button.textContent = '送出中…';
  try {
    const form = new FormData(e.target);
    const file = $('#receiptInput').files[0];
    const payload = Object.fromEntries(form.entries());
    payload.isCustomProject = payload.project === state.bootstrap.otherProjectValue;
    if (payload.isCustomProject) payload.project = String(payload.customProject || '').trim();
    delete payload.customProject;
    payload.receipt = file ? { data: await fileBase64(file), mimeType: file.type, name: file.name } : null;
    const result = await gas('submitEmployeeExpense', payload, state.token);
    toast(result.message);
    e.target.reset(); $('#expenseDate').value = new Date().toLocaleDateString('en-CA');
    $('#receiptPreview').classList.add('hidden'); toggleCustomProject(); $('#expenseDialog').close();
      fillProjectSelect();
    fillSelect($('#expenseCategory'), state.bootstrap.categories, '請選擇類別');
    await loadMine();
  } catch (err) { toast(errorText(err), true); }
  finally { button.disabled = false; button.textContent = '送出報帳'; }
}

async function loadAdmin() {
  if (state.user.role !== 'ADMIN') return;
  setLoading(true);
  try {
    state.adminData = await gas('getAdminDashboard', {
      keyword: $('#adminKeyword').value, month: $('#adminMonth').value
    }, state.token);
    renderAdmin();
  } catch (e) { toast(errorText(e), true); }
  finally { setLoading(false); }
}

function renderAdmin() {
  const d = state.adminData, rows = d.rows;
  $('#filteredTotal').textContent = money(d.summary.filteredTotal);
  $('#employeeCount').textContent = d.employees.filter(x => x.enabled).length;
  $('#projectCount').textContent = Object.keys(d.summary.projects).length;
  $('#expenseCount').textContent = rows.length;
  $('#resultCount').textContent = rows.length + ' 筆';
  renderBars('#monthlyChart', d.summary.monthly, 12);
  renderBars('#yearlyChart', d.summary.yearly, 6);
  renderBars('#employeeChart', d.summary.employees, 8);
  renderBars('#categoryChart', d.summary.categories, 8);
  $('#adminExpenseTable').innerHTML = rows.length ? rows.map(r => `<tr>
    <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.employeeName)}</td><td>${escapeHtml(r.project)}</td>
    <td>${escapeHtml(r.item)}</td><td>${escapeHtml(r.category)}</td><td class="right">${money(r.amount)}</td><td>${receiptLink(r)}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">沒有符合條件的資料</td></tr>';
  $('#adminExpenseList').innerHTML = rows.length ? rows.map(expenseCard).join('') : '<div class="empty">沒有符合條件的資料</div>';
}

function renderBars(selector, obj, limit) {
  const entries = Object.entries(obj || {}).sort((a,b) => b[1] - a[1]).slice(0, limit);
  const max = Math.max(...entries.map(x => x[1]), 1);
  $(selector).innerHTML = entries.length ? entries.map(([label, value]) => `<div class="bar-row">
    <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(value / max * 100, 2)}%"></div></div>
    <span class="bar-value">${money(value)}</span></div>`).join('') : '<div class="empty">尚無資料</div>';
}

async function exportReport(format) {
  setLoading(true);
  try {
    const result = await gas('exportReport', format, { keyword: $('#adminKeyword').value, month: $('#adminMonth').value }, state.token);
    const bytes = Uint8Array.from(atob(result.base64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
    const a = document.createElement('a'); a.href = url; a.download = result.filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('報表已匯出。');
  } catch (e) { toast(errorText(e), true); }
  finally { setLoading(false); }
}

function fillProjectSelect() {
  const select = $('#expenseProject');
  fillSelect(select, state.bootstrap.projects, '請選擇工程');
  select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(state.bootstrap.otherProjectValue)}">其它（自行輸入）</option>`);
  toggleCustomProject();
}
function toggleCustomProject() {
  const isCustom = $('#expenseProject').value === state.bootstrap?.otherProjectValue;
  const field = $('#customProjectField'), input = $('#customProject');
  field.classList.toggle('hidden', !isCustom);
  input.required = isCustom;
  if (!isCustom) input.value = '';
}
function fillSelect(select, values, placeholder) {
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}
function receiptLink(r) { return r.receiptUrl ? `<a class="receipt-link" href="${escapeHtml(r.receiptUrl)}" target="_blank" rel="noopener">查看</a>` : '—'; }
function expenseCard(r) { return `<article class="expense-item"><div class="expense-item-head"><span>${escapeHtml(r.date)}</span><span class="chip">${escapeHtml(r.category)}</span></div><h4>${escapeHtml(r.item)}</h4><p>${escapeHtml(r.employeeName ? r.employeeName + '・' : '')}${escapeHtml(r.project)}</p><div class="expense-item-foot"><span class="expense-amount">${money(r.amount)}</span>${receiptLink(r)}</div></article>`; }
function previewReceipt(e) {
  const file = e.target.files[0], box = $('#receiptPreview');
  if (!file) return box.classList.add('hidden');
  if (file.size > 8 * 1024 * 1024) { e.target.value = ''; return toast('檔案不可超過 8MB。', true); }
  box.classList.remove('hidden');
  box.innerHTML = file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" alt="收據預覽">` : `<span>${escapeHtml(file.name)}</span>`;
}
function fileBase64(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = reject; r.readAsDataURL(file); }); }
function setLoading(show) { $('#loading').classList.toggle('hidden', !show); }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = 'toast show' + (error ? ' error' : ''); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = 'toast', 3500); }
function errorText(e) { return e && e.message ? e.message.replace(/^Exception:\s*/, '') : String(e || '發生未知錯誤'); }
function debounce(fn, delay) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); }; }
function gas(name, ...args) { return new Promise((resolve, reject) => google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[name](...args)); }
</script>
