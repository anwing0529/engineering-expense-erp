<script>
const state = { token: localStorage.getItem('expense_session') || '', user: null, bootstrap: null, myRows: [], adminData: null };
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
    if (state.bootstrap.user) {
      state.user = state.bootstrap.user;
      enterApp();
    } else if (state.token) {
      try {
        state.myRows = await gas('getEmployeeExpenses', state.token);
        const login = JSON.parse(localStorage.getItem('expense_user') || 'null');
        if (!login) throw new Error('登入已過期');
        state.user = login;
        enterApp();
      } catch (e) { clearSession(); showLogin(); }
    } else showLogin();
  } catch (e) {
    showLogin();
    toast(errorText(e), true);
  } finally { setLoading(false); }
}

function bindEvents() {
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
  $('#adminNav').classList.toggle('hidden', state.user.role !== 'ADMIN');
  fillProjectSelect();
  fillSelect($('#expenseCategory'), state.bootstrap.categories, '請選擇類別');
  loadMine();
}

function showLogin() { $('#loginView').classList.remove('hidden'); $('#appView').classList.add('hidden'); }
function clearSession() { state.token = ''; localStorage.removeItem('expense_session'); localStorage.removeItem('expense_user'); }
function switchView(view) {
  if (view === 'admin' && state.user.role !== 'ADMIN') return;
  $$('.view').forEach(x => x.classList.add('hidden'));
  $('#' + view + 'View').classList.remove('hidden');
  $$('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  if (view === 'admin') loadAdmin();
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
