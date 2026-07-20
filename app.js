// ============================================================
// KHARCHA HISAB - app.js
// Data model:
//   /members/{id}  -> { name, count }
//   /expenses/{id} -> { amount, paidBy, includedMembers:[ids], date, note }
// ============================================================

let members = {};   // id -> {name, count}
let expenses = {};  // id -> {amount, paidBy, includedMembers, date, note}
let notes = {};     // id -> { title, content, createdAt }

const AVATAR_COLORS = ['#0b8457','#2563eb','#c0392b','#9333ea','#d97706','#0891b2'];

function applyTheme(theme){
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta){ meta.setAttribute('content', resolved === 'dark' ? '#0a1c14' : '#0b8457'); }
  localStorage.setItem('kharcha-theme', resolved);
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.setAttribute('aria-pressed', resolved === 'dark' ? 'true' : 'false');
    btn.title = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

function initTheme(){
  const saved = localStorage.getItem('kharcha-theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

document.querySelectorAll('.theme-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
});

initTheme();

// ===== Cache management =====
async function cleanupOldCaches(){
  try{
    const cacheNames = await caches.keys();
    const oldCaches = cacheNames.filter(k => k.startsWith('kharcha-hisab-v') && !k.includes(new Date().toISOString().slice(0,10).replace(/-/g,'')));
    if(oldCaches.length > 0){
      console.log('[App] Cleaning old caches:', oldCaches);
      await Promise.all(oldCaches.map(k => caches.delete(k)));
    }
  } catch(e){
    console.warn('Cache cleanup failed:', e);
  }
}

function clearAllCache(){
  if(navigator.serviceWorker && navigator.serviceWorker.controller){
    navigator.serviceWorker.controller.postMessage({type: 'CLEAR_CACHE'});
  }
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  localStorage.clear();
  showToast('Cache cleared. Refreshing...');
  setTimeout(() => location.reload(), 500);
}

// Auto-cleanup on startup
if(navigator.serviceWorker){
  navigator.serviceWorker.ready.then(() => {
    cleanupOldCaches();
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[App] Service worker updated');
    });
  });
}

function colorFor(id){
  let h = 0;
  for(const c of id) h = (h*31 + c.charCodeAt(0)) % 1000;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Attach expense filter controls to re-render on change
(function attachExpenseFilters(){
  const filterFrom = document.getElementById('expenseFilterFrom');
  const filterTo = document.getElementById('expenseFilterTo');
  const filterClear = document.getElementById('expenseFilterClear');
  if(filterFrom) filterFrom.addEventListener('change', renderExpenses);
  if(filterTo) filterTo.addEventListener('change', renderExpenses);
  if(filterClear) filterClear.addEventListener('click', ()=>{
    if(filterFrom) filterFrom.value = '';
    if(filterTo) filterTo.value = '';
    renderExpenses();
  });
})();

function fmt(n){
  const v = Math.round(n * 100) / 100;
  return '₹' + v.toLocaleString('en-IN');
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(()=> t.classList.remove('show'), 2200);
}

function updateAvgPerPerson(totalOverride){
  const total = typeof totalOverride === 'number'
    ? totalOverride
    : Object.values(expenses).reduce((s, e) => s + Number(e.amount || 0), 0);
  const totalPeople = Object.values(members).reduce((s, m) => s + Number(m.count || 0), 0);
  const el = document.getElementById('avgPerPerson');
  if(el) el.textContent = totalPeople > 0 ? fmt(total / totalPeople) : fmt(0);
}

function shareSettlementOnWhatsApp(){
  const balance = computeBalances();
  const txns = simplifyDebts(balance);
  let msg = `*${t('shareSettlementTitle')}*\n\n`;
  if(txns.length === 0){
    msg += t('allSettled');
  } else {
    txns.forEach(txn=>{
      const fromName = members[txn.from] ? members[txn.from].name : '?';
      const toName = members[txn.to] ? members[txn.to].name : '?';
      msg += `${fromName} → ${toName}: ${fmt(txn.amount)}\n`;
    });
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

// ---------------- Navigation ----------------
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('screen-' + btn.dataset.screen).classList.add('active');
    document.getElementById('topbarSub').textContent =
      btn.dataset.screen === 'home' ? t('subHome') :
      btn.dataset.screen === 'members' ? t('subMembers') : t('subExpenses');
  });
});

document.getElementById('fab').addEventListener('click', ()=>{
  const active = document.querySelector('.nav-btn.active').dataset.screen;
  if(active === 'members'){
    openMemberModal(null);
  } else {
    if(active === 'expenses') openExpenseModal(null);
    else if(active === 'notes') openNoteModal(null);
  }
});

// ---------------- Firebase listeners (trip-scoped) ----------------
function attachTripListeners(){
  if(!currentTripId) return;
  membersRef().on('value', membersListener);
  expensesRef().on('value', expensesListener);
  if(typeof notesRef === 'function') notesRef().on('value', notesListener);
}

function detachTripListeners(){
  members = {};
  expenses = {};
  notes = {};
  if(currentTripId){
    membersRef().off('value', membersListener);
    expensesRef().off('value', expensesListener);
    if(typeof notesRef === 'function') notesRef().off('value', notesListener);
  }
}

function membersListener(snap){
  members = snap.val() || {};
  renderMembers();
  renderSettlement();
  populateExpenseForm();
}

function expensesListener(snap){
  expenses = snap.val() || {};
  renderExpenses();
  renderSettlement();
}

function notesListener(snap){
  notes = snap.val() || {};
  renderNotes();
}

function openNoteModal(id){
  document.getElementById('noteModalTitle').textContent = id ? 'Edit Note' : 'New Note';
  document.getElementById('noteEditId').value = id || '';
  document.getElementById('noteDeleteBtn').style.display = id ? 'block' : 'none';
  if(id){
    const n = notes[id] || {};
    document.getElementById('noteTitle').value = n.title || '';
    document.getElementById('noteContent').value = n.content || '';
  } else {
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
  }
  openModal('noteModal');
}

document.getElementById('noteSaveBtn').addEventListener('click', ()=>{
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  const editId = document.getElementById('noteEditId').value;
  if(!title && !content){ showToast('Write a title or content'); return; }
  const data = { title, content };
  if(editId){
    notesRef().child(editId).update(data);
    showToast('Note updated');
  } else {
    data.createdAt = firebase.database.ServerValue.TIMESTAMP;
    notesRef().push(data);
    showToast('Note added');
  }
  closeModal('noteModal');
});

document.getElementById('noteDeleteBtn').addEventListener('click', ()=>{
  const editId = document.getElementById('noteEditId').value;
  if(!editId) return;
  if(confirm('Delete this note?')){
    notesRef().child(editId).remove();
    closeModal('noteModal');
    showToast('Note deleted');
  }
});

function renderNotes(){
  const wrap = document.getElementById('notesList');
  const ids = Object.keys(notes).sort((a,b)=> (notes[b].createdAt||0) - (notes[a].createdAt||0));
  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">No notes yet</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const n = notes[id];
    const preview = (n.content || '').split('\n')[0];
    return `
      <div class="item-card" onclick="openNoteModal('${id}')">
        <div class="item-avatar" style="background:${colorFor(id)}">${(n.title||'').charAt(0) || 'N'}</div>
        <div class="item-body">
          <div class="item-title">${n.title || 'Untitled'}</div>
          <div class="item-sub">${preview}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------------- Members ----------------
function openMemberModal(id){
  document.getElementById('memberModalTitle').textContent = id ? t('memberModalTitleEdit') : t('memberModalTitleNew');
  document.getElementById('memberEditId').value = id || '';
  document.getElementById('memberName').value = id ? members[id].name : '';
  document.getElementById('memberCount').value = id ? members[id].count : '';
  document.getElementById('memberDeleteBtn').style.display = id ? 'block' : 'none';
  openModal('memberModal');
}

document.getElementById('memberSaveBtn').addEventListener('click', ()=>{
  const name = document.getElementById('memberName').value.trim();
  const count = parseInt(document.getElementById('memberCount').value, 10);
  const editId = document.getElementById('memberEditId').value;

  if(!name){ showToast(t('toastNameNeeded')); return; }
  if(!count || count < 1){ showToast(t('toastCountNeeded')); return; }

  const data = { name, count };
  if(editId){
    membersRef().child(editId).update(data);
    showToast(t('toastMemberUpdated'));
  } else {
    membersRef().push(data);
    showToast(t('toastMemberAdded'));
  }
  closeModal('memberModal');
});

document.getElementById('memberDeleteBtn').addEventListener('click', ()=>{
  const editId = document.getElementById('memberEditId').value;
  if(!editId) return;
  if(confirm(t('confirmMemberDelete'))){
    membersRef().child(editId).remove();
    closeModal('memberModal');
    showToast(t('toastMemberDeleted'));
  }
});

function renderMembers(){
  const wrap = document.getElementById('membersList');
  const ids = Object.keys(members);
  const totalEntries = ids.length;
  const totalPeople = ids.reduce((sum, id) => sum + Number(members[id].count || 0), 0);
  const entriesEl = document.getElementById('totalMemberEntries');
  const peopleEl = document.getElementById('totalMemberPeople');
  if(entriesEl) entriesEl.textContent = totalEntries;
  if(peopleEl) peopleEl.textContent = totalPeople + ' ' + t('personWord');
  const breakdownEl = document.getElementById('totalMemberBreakdown');
  if(breakdownEl){
    const parts = ids.map(id => `${members[id].name} ${members[id].count}`);
    breakdownEl.textContent = parts.join(' • ');
  }
  updateAvgPerPerson();

  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noMembers')}</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const m = members[id];
    return `
      <div class="item-card" onclick="openMemberModal('${id}')">
        <div class="item-avatar" style="background:${colorFor(id)}">${m.name.charAt(0)}</div>
        <div class="item-body">
          <div class="item-title">${m.name}</div>
          <div class="item-sub">${m.count} ${t('personWord')}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------------- Expenses ----------------
function populateExpenseForm(){
  const paidBySel = document.getElementById('expensePaidBy');
  const checkWrap = document.getElementById('expenseMembersCheck');
  const ids = Object.keys(members);

  paidBySel.innerHTML = ids.map(id => `<option value="${id}">${members[id].name}</option>`).join('')
    || `<option value="">${t('memberSelectPlaceholder')}</option>`;

  if(ids.length === 0){
    checkWrap.innerHTML = `<p class="empty-hint">${t('addMemberFirst')}</p>`;
    return;
  }

  const rows = ids.map(id => `
    <label class="checkbox-row">
      <input type="checkbox" value="${id}" class="member-check" />
      <span>${members[id].name} (${members[id].count})</span>
    </label>`).join('');

  checkWrap.innerHTML = `
    <label class="checkbox-row select-all-row">
      <input type="checkbox" id="selectAllMembers" />
      <span>${t('selectAllLabel')}</span>
    </label>
    ${rows}`;

  const selectAllBox = document.getElementById('selectAllMembers');
  const memberBoxes = () => Array.from(document.querySelectorAll('.member-check'));

  selectAllBox.addEventListener('change', ()=>{
    memberBoxes().forEach(cb => cb.checked = selectAllBox.checked);
  });
  memberBoxes().forEach(cb=>{
    cb.addEventListener('change', ()=>{
      selectAllBox.checked = memberBoxes().every(box => box.checked);
    });
  });
}

function openExpenseModal(id){
  if(Object.keys(members).length === 0){
    showToast(t('addMemberFirst'));
    return;
  }
  populateExpenseForm();
  document.getElementById('expenseModalTitle').textContent = id ? t('expenseModalTitleEdit') : t('expenseModalTitleNew');
  document.getElementById('expenseEditId').value = id || '';
  document.getElementById('expenseDeleteBtn').style.display = id ? 'block' : 'none';

  if(id){
    const e = expenses[id];
    document.getElementById('expenseAmount').value = e.amount;
    document.getElementById('expensePaidBy').value = e.paidBy;
    document.getElementById('expenseDate').value = e.date;
    // payment method
    const pm = e.paymentMethod || 'cash';
    const pmEl = document.querySelectorAll('input[name="expensePayment"]');
    pmEl.forEach(r => r.checked = (r.value === pm));
    document.getElementById('expenseNote').value = e.note || '';
    const boxes = document.querySelectorAll('.member-check');
    boxes.forEach(cb=>{
      cb.checked = e.includedMembers.includes(cb.value);
    });
    const selectAllBox = document.getElementById('selectAllMembers');
    if(selectAllBox) selectAllBox.checked = Array.from(boxes).every(cb => cb.checked);
  } else {
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('expenseNote').value = '';
  }
  openModal('expenseModal');
}

document.getElementById('expenseSaveBtn').addEventListener('click', ()=>{
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const paidBy = document.getElementById('expensePaidBy').value;
  const date = document.getElementById('expenseDate').value;
  const paymentMethodEl = document.querySelector('input[name="expensePayment"]:checked');
  const paymentMethod = paymentMethodEl ? paymentMethodEl.value : 'cash';
  const note = document.getElementById('expenseNote').value.trim();
  const included = Array.from(document.querySelectorAll('.member-check:checked')).map(cb=>cb.value);
  const editId = document.getElementById('expenseEditId').value;

  if(!amount || amount <= 0){ showToast(t('toastAmountNeeded')); return; }
  if(!paidBy){ showToast(t('toastPaidByNeeded')); return; }
  if(included.length === 0){ showToast(t('toastMembersNeeded')); return; }

  const data = { amount, paidBy, includedMembers: included, date, note, paymentMethod };
  if(editId){
    expensesRef().child(editId).update(data);
    showToast(t('toastExpenseUpdated'));
  } else {
    // stamp creation time so newest entries can be shown first reliably
    data.createdAt = firebase.database.ServerValue.TIMESTAMP;
    expensesRef().push(data);
    showToast(t('toastExpenseAdded'));
  }
  closeModal('expenseModal');
});

document.getElementById('expenseDeleteBtn').addEventListener('click', ()=>{
  const editId = document.getElementById('expenseEditId').value;
  if(!editId) return;
  if(confirm(t('confirmExpenseDelete'))){
    expensesRef().child(editId).remove();
    closeModal('expenseModal');
    showToast(t('toastExpenseDeleted'));
  }
});

function renderExpenses(){
  const wrap = document.getElementById('expensesList');
  // Apply date-range filter (YYYY-MM-DD) if set, then sort by createdAt (newest first),
  // falling back to date string ordering when createdAt is not available.
  let ids = Object.keys(expenses);
  const from = (document.getElementById('expenseFilterFrom') || {value:''}).value;
  const to = (document.getElementById('expenseFilterTo') || {value:''}).value;

  ids = ids.filter(id => {
    const e = expenses[id];
    if(!e) return false;
    if(from && (!e.date || e.date < from)) return false;
    if(to && (!e.date || e.date > to)) return false;
    return true;
  });

  ids.sort((a,b)=>{
    const ea = expenses[a] || {};
    const eb = expenses[b] || {};
    const ca = Number(ea.createdAt) || 0;
    const cb = Number(eb.createdAt) || 0;
    if(cb !== ca) return cb - ca;
    return (eb.date||'').localeCompare(ea.date||'');
  });
  let total = 0;
  Object.values(expenses).forEach(e => total += Number(e.amount));
  document.getElementById('totalExpense').textContent = fmt(total);
  updateAvgPerPerson(total);

  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noExpensesShort')}</p>`;
    return;
  }

  function niceDateLabel(yyyyMMdd){
    if(!yyyyMMdd) return '';
    const parts = yyyyMMdd.split('-');
    if(parts.length !== 3) return yyyyMMdd;
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const today = new Date();
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    const today0 = new Date(y, m, d);
    const diff = Math.round((dt - today0) / (24*60*60*1000));
    if(diff === 0) return t('dateLabelToday') || 'Today';
    if(diff === -1) return t('dateLabelYesterday') || 'Yesterday';
    return dt.toLocaleDateString(CURRENT_LANG === 'gu' ? 'gu-IN' : 'en-IN', { year:'numeric', month:'short', day:'numeric' });
  }

  let lastDate = null;
  const parts = [];
  ids.forEach(id=>{
    const e = expenses[id];
    // skip if filtered out earlier
    if(!e) return;
    const payer = members[e.paidBy] ? members[e.paidBy].name : '?';
    const included = e.includedMembers.filter(mid => members[mid]);
    const totalIndividuals = included.reduce((sum, mid) => sum + Number(members[mid].count || 0), 0);
    const perPerson = totalIndividuals > 0 ? Number(e.amount) / totalIndividuals : 0;

    const breakdownRows = included.map(mid=>{
      const m = members[mid];
      const share = perPerson * Number(m.count || 0);
      const isPayer = mid === e.paidBy;
      return `
        <div class="breakdown-row">
          <span>${m.name} (${m.count} ${t('personWord')})${isPayer ? ' 💰' : ''}</span>
          <span>${fmt(share)}</span>
        </div>`;
    }).join('');

    // insert date separator when date changes
    if(e.date && e.date !== lastDate){
      parts.push(`<div class="date-sep">${niceDateLabel(e.date)}</div>`);
      lastDate = e.date;
    }

    parts.push(`
      <div class="item-card expense-card">
        <div class="item-card-top" onclick="openExpenseModal('${id}')">
          <div class="item-avatar" style="background:${colorFor(e.paidBy||id)}">${payer.charAt(0)}</div>
                <div class="item-body">
                  <div class="item-title">${e.note ? e.note : payer + ' ' + t('paidSuffix')}</div>
                  <div class="item-sub">${payer} ${t('paidWord')}${e.date ? ' • ' + e.date : ''} ${e.paymentMethod ? ' • ' + (e.paymentMethod === 'cash' ? 'Cash' : 'Online') : ''}</div>
                </div>
          <div class="item-trail">
            <div class="item-amount">${fmt(e.amount)}</div>
          </div>
        </div>
        <div class="breakdown-box">
          <div class="breakdown-head">${t('perPersonPrefix')} ${totalIndividuals} ${t('perPersonMiddle')} ${fmt(perPerson)}</div>
          ${breakdownRows}
        </div>
      </div>`);
  });

  wrap.innerHTML = parts.join('');
}

// Export expenses (CSV / TXT) filtered by current From/To
function gatherFilteredExpenses(){
  const from = (document.getElementById('expenseFilterFrom') || {value:''}).value;
  const to = (document.getElementById('expenseFilterTo') || {value:''}).value;
  const ids = Object.keys(expenses).filter(id => {
    const e = expenses[id];
    if(!e) return false;
    if(from && (!e.date || e.date < from)) return false;
    if(to && (!e.date || e.date > to)) return false;
    return true;
  }).sort((a,b)=> (expenses[b].createdAt||0) - (expenses[a].createdAt||0));
  return ids.map(id => ({ id, ...expenses[id] }));
}

function exportExpensesAsCSV(rows){
  const header = ['id','date','amount','paidBy','paidByName','includedMembers','includedMemberNames','paymentMethod','note','createdAt'];

  function csvEscape(v){
    if(v === null || v === undefined) v = '';
    v = String(v);
    // Prevent Excel interpreting values as formulas (leading = + - @)
    if(/^[=+\-@]/.test(v)) v = "'" + v;
    // Escape double quotes
    v = v.replace(/"/g, '""');
    return '"' + v + '"';
  }

  const lines = [header.map(h => csvEscape(h)).join(',')];
  rows.forEach(r=>{
    const paidByName = members[r.paidBy] ? members[r.paidBy].name : '';
    const includedNames = (r.includedMembers||[]).map(mid => members[mid] ? members[mid].name : mid).join('|');
    const includedList = (r.includedMembers||[]).join('|');
    const createdAtIso = r.createdAt ? new Date(Number(r.createdAt)).toISOString() : '';
    const fields = [r.id, r.date || '', r.amount, r.paidBy || '', paidByName, includedList, includedNames, r.paymentMethod||'', r.note||'', createdAtIso];
    const line = fields.map(f => csvEscape(f)).join(',');
    lines.push(line);
  });

  // totals per member
  const totals = {};
  rows.forEach(r=>{
    const included = (r.includedMembers||[]).filter(id=>members[id]);
    const totalIndividuals = included.reduce((s, mid) => s + Number(members[mid].count || 0), 0);
    const perPerson = totalIndividuals > 0 ? Number(r.amount) / totalIndividuals : 0;
    included.forEach(mid=>{
      totals[mid] = (totals[mid] || 0) + perPerson * Number(members[mid].count || 0);
    });
  });
  lines.push('');
  lines.push(csvEscape('Totals per member:'));
  Object.keys(totals).forEach(mid=>{
    lines.push([csvEscape(members[mid] ? members[mid].name : mid), csvEscape(totals[mid])].join(','));
  });

  return lines.join('\n');
}

function downloadFile(filename, content, mime){
  // include UTF-8 BOM so Excel recognizes UTF-8 correctly
  const bom = '\uFEFF';
  const blob = new Blob([bom + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
}

function handleExport(){
  const format = (document.getElementById('expenseExportFormat') || {value:'csv'}).value;
  const rows = gatherFilteredExpenses();
  if(rows.length === 0){ showToast('No expenses to export'); return; }
  const csv = exportExpensesAsCSV(rows);
  const fname = 'expenses_' + (new Date().toISOString().slice(0,10)) + '.' + (format === 'csv' ? 'csv' : 'txt');
  downloadFile(fname, csv, 'text/csv;charset=utf-8;');
}

function handleShareWhatsApp(){
  const rows = gatherFilteredExpenses();
  if(rows.length === 0){ showToast('No expenses to share'); return; }
  const csv = exportExpensesAsCSV(rows);
  // try to open WhatsApp with the text (note: limited length)
  const maxLen = 3000;
  const text = 'Expenses\n\n' + csv;
  if(text.length < maxLen){
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  } else {
    // fallback: download file and inform user to share manually
    downloadFile('expenses.txt', csv, 'text/plain;charset=utf-8;');
    showToast('File downloaded; share it manually via WhatsApp');
  }
}

// wire export buttons
const expBtn = document.getElementById('expenseExportBtn');
if(expBtn) expBtn.addEventListener('click', handleExport);
const expShareBtn = document.getElementById('expenseShareWhatsApp');
if(expShareBtn) expShareBtn.addEventListener('click', handleShareWhatsApp);

// ---------------- Settlement calculation ----------------
function computeBalances(){
  // balance[id] = total paid - total share owed
  const balance = {};
  Object.keys(members).forEach(id => balance[id] = 0);

  Object.values(expenses).forEach(e=>{
    const included = e.includedMembers.filter(id => members[id]);
    if(included.length === 0) return;

    const totalIndividuals = included.reduce((sum, id) => sum + Number(members[id].count || 0), 0);
    if(totalIndividuals <= 0) return;

    const perPerson = Number(e.amount) / totalIndividuals;

    included.forEach(id=>{
      const share = perPerson * Number(members[id].count || 0);
      balance[id] = (balance[id] || 0) - share;
    });

    if(members[e.paidBy]){
      balance[e.paidBy] = (balance[e.paidBy] || 0) + Number(e.amount);
    }
  });

  return balance; // positive = should receive, negative = should pay
}

function simplifyDebts(balance){
  // Greedy min-transaction settlement
  const creditors = [];
  const debtors = [];
  Object.entries(balance).forEach(([id, bal])=>{
    if(bal > 0.5) creditors.push({id, amt: bal});
    else if(bal < -0.5) debtors.push({id, amt: -bal});
  });
  creditors.sort((a,b)=> b.amt - a.amt);
  debtors.sort((a,b)=> b.amt - a.amt);

  const txns = [];
  let i=0, j=0;
  while(i < debtors.length && j < creditors.length){
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    txns.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if(debtors[i].amt < 0.5) i++;
    if(creditors[j].amt < 0.5) j++;
  }
  return txns;
}

function renderSettlement(){
  const balance = computeBalances();
  const settleWrap = document.getElementById('settlementList');
  const balanceWrap = document.getElementById('balanceList');

  const txns = simplifyDebts(balance);
  if(txns.length === 0){
    settleWrap.innerHTML = `<p class="empty-hint">${t('allSettled')}</p>`;
  } else {
    settleWrap.innerHTML = txns.map(txn=>{
      const fromName = members[txn.from] ? members[txn.from].name : '?';
      const toName = members[txn.to] ? members[txn.to].name : '?';
      return `
        <div class="settle-card">
          <span class="settle-name">${fromName}</span>
          <span class="settle-arrow">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
          </span>
          <span class="settle-name">${toName}</span>
          <span class="settle-amount">${fmt(txn.amount)}</span>
        </div>`;
    }).join('');
  }

  const ids = Object.keys(members);
  if(ids.length === 0){
    balanceWrap.innerHTML = '';
    return;
  }
  balanceWrap.innerHTML = ids.map(id=>{
    const bal = balance[id] || 0;
    const cls = bal > 0.5 ? 'get' : bal < -0.5 ? 'owe' : '';
    const label = bal > 0.5 ? t('getWord') : bal < -0.5 ? t('oweWord') : t('sameWord');
    return `
      <div class="balance-card">
        <span class="settle-name">${members[id].name}</span>
        <span class="item-amount ${cls}">${label} ${fmt(Math.abs(bal))}</span>
      </div>`;
  }).join('');
}

const shareSettlementBtn = document.getElementById('shareSettlementBtn');
if(shareSettlementBtn) shareSettlementBtn.addEventListener('click', shareSettlementOnWhatsApp);

// ---------------- PWA: service worker ----------------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// ---------------- PWA: install prompt ----------------
let deferredPrompt = null;
const pwaInstallBtn = document.getElementById('pwaInstallBtn');
const pwaInstallBtn2 = document.getElementById('pwaInstallBtn2');
const installCards = Array.from(document.querySelectorAll('[data-pwa-install-card]'));
const installCtaButtons = Array.from(document.querySelectorAll('[data-pwa-install-cta]'));
const installHelpButtons = Array.from(document.querySelectorAll('[data-pwa-install-help]'));
const installHelpBoxes = Array.from(document.querySelectorAll('[data-pwa-install-helpbox]'));

function isStandaloneMode(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true;
}

function isIOSDevice(){
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function updateInstallUi(){
  const canPrompt = Boolean(deferredPrompt);
  const standalone = isStandaloneMode();
  installCards.forEach(card => {
    card.style.display = standalone ? 'none' : 'block';
  });
  // compact install banner(s)
  const banners = Array.from(document.querySelectorAll('.install-banner'));
  const dismissed = localStorage.getItem('kh_install_dismissed');
  const today = new Date().toISOString().slice(0,10);
  banners.forEach(b => {
    b.style.display = (canPrompt && !standalone && dismissed !== today) ? 'flex' : 'none';
  });
  if(pwaInstallBtn) pwaInstallBtn.style.display = canPrompt && !standalone ? 'flex' : 'none';
  if(pwaInstallBtn2) pwaInstallBtn2.style.display = canPrompt && !standalone ? 'flex' : 'none';
  installCtaButtons.forEach(btn => {
    btn.style.display = canPrompt && !standalone ? 'inline-flex' : 'none';
  });
  installHelpButtons.forEach(btn => {
    btn.style.display = !standalone ? 'inline-flex' : 'none';
  });
}

async function triggerInstallFlow(){
  if(deferredPrompt){
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if(outcome === 'accepted') showToast('એપ ઇન્સ્ટોલ شدી');
    else showToast('ઇન્સ્ટોલ રદ થયું');
    deferredPrompt = null;
    updateInstallUi();
    return;
  }

  if(isIOSDevice()){
    showToast('Share > Add to Home Screen પસંદ કરો');
  } else {
    showToast('બ્રાઉઝર મેનૂમાંથી આ એપ ઇન્સ્ટોલ કરો');
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  updateInstallUi();
});

// wire banner buttons (Install / Not now) for all banners
Array.from(document.querySelectorAll('.installBannerBtn')).forEach(btn=> btn.addEventListener('click', ()=> triggerInstallFlow()));
Array.from(document.querySelectorAll('.installBannerDismiss')).forEach(btn=> btn.addEventListener('click', ()=>{
  const today = new Date().toISOString().slice(0,10);
  localStorage.setItem('kh_install_dismissed', today);
  updateInstallUi();
}));

if(pwaInstallBtn){
  pwaInstallBtn.addEventListener('click', triggerInstallFlow);
}

if(pwaInstallBtn2){
  pwaInstallBtn2.addEventListener('click', triggerInstallFlow);
}

installCtaButtons.forEach(btn => {
  btn.addEventListener('click', triggerInstallFlow);
});

installHelpButtons.forEach((btn, index) => {
  btn.addEventListener('click', () => {
    const box = installHelpBoxes[index];
    if(box) box.style.display = box.style.display === 'block' ? 'none' : 'block';
  });
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  updateInstallUi();
  showToast('એપ ઇન્સ્ટોલ شدી');
});

window.addEventListener('load', updateInstallUi);
