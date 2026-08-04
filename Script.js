<script>
const state = { token: localStorage.getItem('expense_session') || '', user: null, bootstrap: null, myRows: [], workOrders: [], workReportPhotos: [], workReportReceipts: [], employeeHistoryLimit: 10, adminHistoryLimit: 10, adminData: null, dispatchData: null, currentView: '', workflowRefreshTimer: null, workflowRefreshBusy: false };
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
  $('#openExpenseBtn')?.addEventListener('click', () => $('#expenseDialog').showModal());
  $$('.close-dialog').forEach(btn => btn.addEventListener('click', () => $('#expenseDialog').close()));
  $('#expenseForm').addEventListener('submit', submitExpense);
  $('#expenseProject').addEventListener('change', toggleCustomProject);
  $('#receiptInput').addEventListener('change', previewReceipt);
$('#refreshMineBtn').addEventListener('click', refreshEmployeeHistory);
  $('#loadMoreEmployeeHistoryBtn').addEventListener('click', () => {
    state.employeeHistoryLimit += 10;
    renderEmployeeDispatchHistory();
  });
  $('#refreshWorkOrdersBtn').addEventListener('click', loadWorkOrders);
  $('#employeeWorkOrderList').addEventListener('click', e => {
    const card = e.target.closest('[data-task-id]');
    if (!card) return;
    const task = state.workOrders.find(item => item.id === card.dataset.taskId);
    if (task?.workflow) openEmployeePaymentDialog(task.id);
    else openWorkReport(card.dataset.taskId);
  });
  $$('.close-employee-payment').forEach(button =>
    button.addEventListener('click', () => $('#employeePaymentDialog').close()));
  $('#employeePaymentForm').addEventListener('submit', requestEmployeePayment);
  $('#saveEmployeePaymentNoteBtn').addEventListener('click', saveEmployeePaymentNote);
  $$('.close-work-report').forEach(btn => btn.addEventListener('click', () => $('#workReportDialog').close()));
  $('#workReportForm').addEventListener('submit', submitWorkReport);
  $('#completionPhotoInput').addEventListener('change', e => addWorkReportFiles(e, 'photos'));
  $('#workReportReceiptInput').addEventListener('change', e => addWorkReportFiles(e, 'receipts'));
  $('#completionPhotoPreview').addEventListener('click', removeWorkReportFile);
  $('#workReportReceiptPreview').addEventListener('click', removeWorkReportFile);
  $('#workReportForm').addEventListener('change', toggleWorkReportOtherCategory);
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
  ['#employeePageUserName', '#dispatchPageUserName', '#adminPageUserName'].forEach(selector => {
    const target = $(selector);
    if (target) target.textContent = state.user.name;
  });
  state.user.role = String(state.user.role || 'EMPLOYEE').toUpperCase();
  const isAdmin = state.user.role === 'ADMIN';
  $('#dispatchNav').classList.toggle('hidden', !isAdmin);
  $('#adminNav').classList.toggle('hidden', !isAdmin);
  fillProjectSelect();
  fillSelect($('#expenseCategory'), state.bootstrap.categories, '請選擇類別');
  if (isAdmin) switchView('dispatch');
  else switchView('employee');
  startWorkflowAutoRefresh();
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function clearSession() {
  state.token = '';
  if (state.workflowRefreshTimer) clearInterval(state.workflowRefreshTimer);
  state.workflowRefreshTimer = null;
  localStorage.removeItem('expense_session');
  localStorage.removeItem('expense_user');
}
function switchView(view) {
  if (['admin', 'dispatch'].includes(view) && state.user.role !== 'ADMIN') return;
  state.currentView = view;
  $$('.view').forEach(x => x.classList.add('hidden'));
  $('#' + view + 'View').classList.remove('hidden');
  $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  if (view === 'admin') loadAdmin();
  if (view === 'dispatch') loadDispatch();
  if (view === 'employee') {

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
  const activeTasks = state.workOrders.filter(task => !isCompletedDispatchHistory(task));
  if (!activeTasks.length) {
    box.innerHTML = '<div class="empty">目前沒有進行中的派工；已付款工單可在下方歷史回查。</div>';
  } else {
    box.innerHTML = activeTasks.map(task => {
      const completed = new Set((task.reports || []).flatMap(report => report.completedItemIds || []));
      const total = task.workItems.length;
      const done = task.workItems.filter(item => completed.has(item.id)).length;
      const workflow = task.workflow;
      const actionText = !workflow ? '進入工單'
        : workflow.status === '可請款' ? '請款'
        : workflow.status === '待付款' ? '查看待付款'
        : workflow.status === '已付款' ? '查看付款'
        : '查看審核';
      const workflowInfo = workflow
        ? '<div class="employee-payment-strip"><div><small>' + escapeHtml(workflow.status) +
          '</small><strong>待付款金額 ' + money(workflow.amount) + '</strong></div>' +
          '<span>工程費用 ' + money(workflow.engineeringAmount) + '／報帳費用 ' + money(workflow.expenseAmount) + '</span>' +
          (workflow.adminNote ? '<span>' + escapeHtml(workflow.adminNote) + '</span>' : '') + '</div>'
        : '';
      return '<button type="button" class="employee-work-order-card" data-task-id="' + escapeHtml(task.id) + '">' +
        '<div class="work-order-card-head"><div><small>' + escapeHtml(task.id) + '</small><h4>' + escapeHtml(task.name) + '</h4></div><span class="chip">' + escapeHtml(workflow?.status || task.status) + '</span></div>' +
        '<p class="work-order-address"><span class="material-symbols-rounded">location_on</span>' + escapeHtml(task.address) + '</p>' +
        workflowProgressHtml(dispatchProgressStatus(task.status, workflow)) +
        '<div class="work-order-progress"><div><span style="width:' + (total ? done / total * 100 : 0) + '%"></span></div><small>' + done + ' / ' + total + ' 項完成</small></div>' +
        workflowInfo +
        '<div class="work-order-card-foot"><span>預定 ' + escapeHtml(task.scheduledDate) + '</span><strong>' + actionText + ' <span class="material-symbols-rounded">arrow_forward</span></strong></div></button>';
    }).join('');
  }
  renderEmployeeDispatchHistory();
  const reports = state.workOrders.flatMap(task => task.reports || []);
  $('#myTotal').textContent = money(reports.reduce((sum, report) =>
    sum + Number(report.materialAmount || 0), 0));
  $('#myCount').textContent = reports.length;
}

function openEmployeePaymentDialog(taskId) {
  const task = state.workOrders.find(item => item.id === taskId);
  if (!task?.workflow) return toast('此工單尚未建立審核資料。', true);
  const workflow = task.workflow;
  $('#employeePaymentTaskId').value = task.id;
  $('#employeePaymentTaskCode').textContent = task.id;
  $('#employeePaymentTitle').textContent = task.name + '｜請款';
  $('#employeePendingAmount').textContent = money(workflow.amount);
  $('#employeePaymentStatus').textContent = workflow.status;
  $('#employeeAdminReviewNote').value = workflow.adminNote || '等待老闆填寫審核內容';
  $('#employeePaymentNote').value = workflow.employeeNote || '';
  $('#requestEmployeePaymentBtn').classList.toggle('hidden', workflow.status !== '可請款');
  $('#saveEmployeePaymentNoteBtn').classList.toggle('hidden', workflow.status === '已付款');
  $('#employeePaymentNote').readOnly = workflow.status === '已付款';
  $('#employeePaymentDialog').showModal();
}

async function saveEmployeePaymentNote() {
  const button = $('#saveEmployeePaymentNoteBtn');
  button.disabled = true;
  try {
    const result = await gas('saveMyPaymentNote', {
      taskId: $('#employeePaymentTaskId').value,
      note: $('#employeePaymentNote').value
    }, state.token);
    toast(result.message);
    await loadWorkOrders();
  } catch (error) { toast(errorText(error), true); }
  finally { button.disabled = false; }
}

async function requestEmployeePayment(event) {
  event.preventDefault();
  const button = $('#requestEmployeePaymentBtn');
  if (button.classList.contains('hidden')) return;
  button.disabled = true; button.textContent = '送出中…';
  try {
    const result = await gas('requestMyDispatchPayment', {
      taskId: $('#employeePaymentTaskId').value,
      note: $('#employeePaymentNote').value
    }, state.token);
    toast(result.message);
    $('#employeePaymentDialog').close();
    await loadWorkOrders();
  } catch (error) { toast(errorText(error), true); }
  finally { button.disabled = false; button.textContent = '送出請款'; }
}
function dispatchProgressStatus(taskStatus, workflow) {
  if (!workflow) return taskStatus;
  if (workflow.status === '已付款') return '付款';
  if (workflow.status === '可請款' || workflow.status === '待付款') return '請款';
  if (workflow.status === '待審核') return '驗收';
  return taskStatus;
}

function startWorkflowAutoRefresh() {
  if (state.workflowRefreshTimer) clearInterval(state.workflowRefreshTimer);
  state.workflowRefreshTimer = setInterval(async () => {
    if (!state.user || document.hidden || state.workflowRefreshBusy) return;
    state.workflowRefreshBusy = true;
    try {
      if (state.currentView === 'employee' && state.user.role === 'EMPLOYEE') await loadWorkOrders();
      if (state.currentView === 'dispatch' && state.user.role === 'ADMIN') await loadDispatch(true);
    } finally {
      state.workflowRefreshBusy = false;
    }
  }, 20000);
}
function isCompletedDispatchHistory(taskOrStatus) {
  if (taskOrStatus && typeof taskOrStatus === 'object') {
    if (taskOrStatus.workflow) return taskOrStatus.workflow.status === '已付款';
    return ['請款', '付款'].includes(normalizeDispatchStage(taskOrStatus.status));
  }
  return ['請款', '付款'].includes(normalizeDispatchStage(taskOrStatus));
}

function refreshEmployeeHistory() {
  state.employeeHistoryLimit = 10;
  if (state.user?.role === 'EMPLOYEE') loadWorkOrders();
}

function renderEmployeeDispatchHistory() {
  const table = $('#employeeDispatchHistoryTable');
  if (!table) return;
  const rows = state.workOrders
    .filter(task => isCompletedDispatchHistory(task))
    .sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)));
  const shown = rows.slice(0, state.employeeHistoryLimit);
  table.innerHTML = shown.length
    ? shown.map(dispatchHistoryTableRow).join('')
    : '<tr><td colspan="7" class="empty">目前沒有已完工派工記錄</td></tr>';
  $('#employeeDispatchHistoryMobile').innerHTML = shown.length
    ? shown.map(dispatchHistoryCard).join('')
    : '<div class="empty">目前沒有已完工派工記錄</div>';
  updateHistoryLoadMore('employee', shown.length, rows.length);
}

function dispatchHistoryTableRow(task) {
  const quote = Number(task.totalQuote || 0);
  const expense = Number(task.reportAmount || 0);
  return '<tr><td>' + escapeHtml(task.scheduledDate) + '</td><td>' +
    escapeHtml(task.name) + '</td><td class="history-address">' +
    escapeHtml(task.address) + '</td><td>' +
    escapeHtml((task.workItems || []).map(item => item.content).join('、')) +
    '</td><td class="right">' + money(quote) + '</td><td class="right">' +
    money(expense) + '</td><td class="right history-total">' +
    money(quote + expense) + '</td></tr>';
}

function dispatchHistoryCard(task) {
  const quote = Number(task.totalQuote || 0);
  const expense = Number(task.reportAmount || 0);
  return '<article class="history-card"><div class="history-card-head"><small>' +
    escapeHtml(task.scheduledDate) + '</small><span class="chip">' +
    escapeHtml(normalizeDispatchStage(task.status)) + '</span></div><h4>' +
    escapeHtml(task.name) + '</h4><p><span class="material-symbols-rounded">location_on</span>' +
    escapeHtml(task.address) + '</p><div class="history-work">' +
    escapeHtml((task.workItems || []).map(item => item.content).join('、')) +
    '</div><dl><div><dt>工程報價</dt><dd>' + money(quote) +
    '</dd></div><div><dt>報帳金額</dt><dd>' + money(expense) +
    '</dd></div><div class="total"><dt>合計</dt><dd>' +
    money(quote + expense) + '</dd></div></dl></article>';
}

function updateHistoryLoadMore(role, shown, total) {
  const prefix = role === 'employee' ? 'employee' : 'admin';
  $('#' + prefix + 'HistoryCount').textContent =
    total ? '已顯示 ' + shown + '／' + total + ' 筆' : '共 0 筆';
  $('#' + (role === 'employee' ? 'loadMoreEmployeeHistoryBtn' : 'loadMoreAdminHistoryBtn'))
    .classList.toggle('hidden', shown >= total);
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
  state.workReportPhotos = [];
  state.workReportReceipts = [];
  renderWorkReportFiles();
  toggleWorkReportOtherCategory();
  $('#workReportDialog').showModal();
}

async function submitWorkReport(e) {
  e.preventDefault();
  const button = $('#submitWorkReportBtn');
  button.disabled = true; button.textContent = '送出中…';
  try {
    if (!state.workReportPhotos.length) throw new Error('請至少上傳 1 張完工照片。');
    const selectedCategories = $$('input[name="workReportCategory"]:checked')
      .map(input => input.value);
    const reportAmount = Number($('#workReportMaterialAmount').value || 0);
    if (reportAmount > 0 && !selectedCategories.length) {
      throw new Error('有填寫報帳金額時，請至少勾選一個費用類別。');
    }
    const payload = {
      taskId: $('#workReportTaskId').value,
      completedItemIds: $$('#workReportItems input:checked:not(:disabled)').map(input => input.value),
      categories: selectedCategories,
      otherCategory: $('#workReportOtherCategory').value.trim(),
      amount: $('#workReportMaterialAmount').value,
      note: $('#workReportNote').value.trim(),
      completionPhotos: await Promise.all(state.workReportPhotos.map(serializeWorkReportFile)),
      receipts: await Promise.all(state.workReportReceipts.map(serializeWorkReportFile))
    };
    const result = await gas('submitDispatchWorkReport', payload, state.token);
    toast(result.message);
    $('#workReportDialog').close();
    await loadWorkOrders();
  } catch (err) { toast(errorText(err), true); }
  finally { button.disabled = false; button.textContent = '送出工單回報'; }
}

function toggleWorkReportOtherCategory() {
  const selected = $$('input[name="workReportCategory"]:checked').map(input => input.value);
  const isOther = selected.includes('__OTHER_EXPENSE__');
  $('#workReportOtherCategoryField').classList.toggle('hidden', !isOther);
  $('#workReportOtherCategory').required = Boolean(isOther);
  if (!isOther) $('#workReportOtherCategory').value = '';
}

function addWorkReportFiles(e, kind) {
  const incoming = [...e.target.files];
  const allowPdf = kind === 'receipts';
  const invalid = incoming.find(file =>
    file.size > 8 * 1024 * 1024 ||
    (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
      !(allowPdf && file.type === 'application/pdf')));
  if (invalid) {
    e.target.value = '';
    return toast('檔案格式不支援，或單一檔案超過 8MB。', true);
  }
  const key = kind === 'photos' ? 'workReportPhotos' : 'workReportReceipts';
  if (state[key].length + incoming.length > 10) {
    e.target.value = '';
    return toast('同一類附件最多 10 個檔案。', true);
  }
  state[key] = state[key].concat(incoming);
  e.target.value = '';
  renderWorkReportFiles();
}

function removeWorkReportFile(e) {
  const button = e.target.closest('[data-file-kind][data-file-index]');
  if (!button) return;
  const key = button.dataset.fileKind === 'photos' ? 'workReportPhotos' : 'workReportReceipts';
  state[key].splice(Number(button.dataset.fileIndex), 1);
  renderWorkReportFiles();
}

function renderWorkReportFiles() {
  renderWorkReportFileGroup('#completionPhotoPreview', state.workReportPhotos, 'photos',
    '<div class="photo-preview-placeholder"><span class="material-symbols-rounded">add_photo_alternate</span><span>請新增至少 1 張完工照片</span></div>');
  renderWorkReportFileGroup('#workReportReceiptPreview', state.workReportReceipts, 'receipts',
    '<div class="photo-preview-placeholder optional"><span class="material-symbols-rounded">receipt_long</span><span>材料收據為選填</span></div>');
}

function renderWorkReportFileGroup(selector, files, kind, emptyHtml) {
  $(selector).innerHTML = files.length ? files.map((file, index) => {
    const preview = file.type.startsWith('image/')
      ? '<img src="' + URL.createObjectURL(file) + '" alt="附件預覽">'
      : '<span class="material-symbols-rounded file-icon">picture_as_pdf</span>';
    return '<figure>' + preview + '<figcaption>' + escapeHtml(file.name) + '</figcaption>' +
      '<button type="button" class="remove-preview" data-file-kind="' + kind +
      '" data-file-index="' + index + '" aria-label="移除附件">×</button></figure>';
  }).join('') : emptyHtml;
}

function serializeWorkReportFile(file) {
  return fileBase64(file).then(data => ({
    data: data, mimeType: file.type, name: file.name
  }));
}
async function loadMine() {
  try {
    state.myRows = await gas('getEmployeeExpenses', state.token);
    renderMine();
  } catch (e) { toast(errorText(e), true); }
}

function renderMine() {
  $('#myTotal').textContent = money(state.myRows.reduce((sum, row) => sum + row.amount, 0));
  $('#myCount').textContent = state.myRows.length;
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
