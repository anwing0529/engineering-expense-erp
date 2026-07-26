(function(){
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const money = value => 'NT$ ' + Number(value || 0).toLocaleString('zh-TW');

  const dialog = $('#expenseDialog');
  $('#openExpenseBtn')?.addEventListener('click', () => dialog.showModal());
  $$('.closeDialog').forEach(button => button.addEventListener('click', () => dialog.close()));
  $('#expenseForm')?.addEventListener('submit', event => {
    event.preventDefault();
    $('#formNotice').style.display = 'block';
  });

  const keyword = $('#keyword');
  const month = $('#month');
  const filterRows = () => {
    const query = (keyword?.value || '').trim().toLowerCase();
    const selectedMonth = month?.value || '';
    let visible = 0;
    $$('#expenseRows tr').forEach(row => {
      const matchesKeyword = !query || row.textContent.toLowerCase().includes(query);
      const matchesMonth = !selectedMonth || row.dataset.month === selectedMonth;
      row.hidden = !(matchesKeyword && matchesMonth);
      if (!row.hidden) visible += 1;
    });
    if ($('#resultCount')) $('#resultCount').textContent = visible + ' 筆';
  };
  keyword?.addEventListener('input', filterRows);
  month?.addEventListener('change', filterRows);
  $('#clearFilters')?.addEventListener('click', () => {
    keyword.value = '';
    month.value = '';
    filterRows();
  });

  $$('.demoOnly').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    alert('這是 GitHub Pages 靜態展示資料。正式功能由 Google Apps Script 執行。');
  }));

  $$('.money').forEach(node => {
    node.textContent = money(node.dataset.value);
  });
})();
