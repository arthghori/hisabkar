// ============================================================
// KHARCHA HISAB - app.js
// Data model:
//   /members/{id}  -> { name, count }
//   /expenses/{id} -> { amount, paidBy, includedMembers:[ids], date, note }
// ============================================================

let members = {};   // id -> {name, count}
let expenses = {};  // id -> {amount, paidBy, includedMembers, date, note}
let notes = {};     // id -> { title, content, createdAt }
let payments = {};  // id -> {from, to, amount, date, note, createdAt} - settle-up records

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
  } else if(active === 'home'){
    openPaymentModal(null);
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
  if(typeof paymentsRef === 'function') paymentsRef().on('value', paymentsListener);
}

function detachTripListeners(){
  members = {};
  expenses = {};
  notes = {};
  payments = {};
  if(currentTripId){
    membersRef().off('value', membersListener);
    expensesRef().off('value', expensesListener);
    if(typeof notesRef === 'function') notesRef().off('value', notesListener);
    if(typeof paymentsRef === 'function') paymentsRef().off('value', paymentsListener);
  }
}

function membersListener(snap){
  members = snap.val() || {};
  renderMembers();
  renderSettlement();
  populateExpenseForm();
  populatePaymentForm();
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

function paymentsListener(snap){
  payments = snap.val() || {};
  renderSettlement();
  renderPayments();
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

// Share stepper config: shares move in 0.5 steps (0, 0.5, 1, 1.5, 2 ...)
const SHARE_STEP = 0.5;
const SHARE_MIN = 0;
const SHARE_MAX = 20;
const SHARE_DEFAULT = 1;

// Round to nearest 0.5 and clamp to [SHARE_MIN, SHARE_MAX]
function clampShare(v){
  v = Math.round(v / SHARE_STEP) * SHARE_STEP;
  if(v < SHARE_MIN) v = SHARE_MIN;
  if(v > SHARE_MAX) v = SHARE_MAX;
  // avoid floating point artifacts like 1.4999999999999998
  return Math.round(v * 100) / 100;
}

// Display "1" instead of "1.0", but "1.5" stays "1.5"
function formatShareValue(v){
  v = clampShare(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function defaultShareValue(){
  return SHARE_DEFAULT;
}

// The weight used to split an expense for a given member id:
// prefers the expense's own custom share, falls back to the
// member's household headcount for expenses saved before this feature.
function expenseWeight(e, mid){
  if(e && e.shares && e.shares[mid] != null) return Number(e.shares[mid]) || 0;
  return Number(members[mid] && members[mid].count || 0);
}

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
    <div class="share-row" data-id="${id}">
      <div class="share-left">
        <span class="share-check" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <div class="share-name">${members[id].name} <span class="share-count">(${members[id].count})</span></div>
      </div>
      <div class="share-stepper" data-value="0"></div>
    </div>`).join('');

  checkWrap.innerHTML = `
    <div class="share-toolbar">
      <button type="button" class="share-toolbar-btn" id="selectAllMembers">${t('selectAllLabel')}</button>
      <button type="button" class="share-toolbar-btn share-toolbar-clear" id="clearAllShares">${t('clearAllLabel')}</button>
    </div>
    ${rows}`;

  wireShareSteppers();
}

// Wires up each row's tap-to-select + fine-tune stepper, plus the
// select-all / clear-all toolbar. Every row manages only its own DOM
// and its own data-value — selecting one member never touches another.
function wireShareSteppers(){
  const rows = Array.from(document.querySelectorAll('#expenseMembersCheck .share-row[data-id]'));

  rows.forEach(row=>{
    const id = row.dataset.id;
    const stepperEl = row.querySelector('.share-stepper');
    stepperEl.addEventListener('click', (ev)=> ev.stopPropagation());

    // Rebuilds this row's right-hand control to match its current value:
    // 0 -> a single round "+" button; >0 -> a full "− value +" stepper.
    // Only ever touches this row's own elements.
    const renderControl = ()=>{
      const v = Number(stepperEl.dataset.value || 0);
      row.classList.toggle('active', v > 0);
      stepperEl.classList.toggle('has-value', v > 0);

      if(v > 0){
        stepperEl.innerHTML = `
          <button type="button" class="share-btn share-minus" aria-label="minus">−</button>
          <span class="share-value">${formatShareValue(v)}</span>
          <button type="button" class="share-btn share-plus" aria-label="plus">+</button>`;
        stepperEl.querySelector('.share-minus').addEventListener('click', (ev)=>{
          ev.stopPropagation();
          setVal(v - SHARE_STEP);
        });
        stepperEl.querySelector('.share-plus').addEventListener('click', (ev)=>{
          ev.stopPropagation();
          setVal(v + SHARE_STEP);
        });
      } else {
        stepperEl.innerHTML = `<button type="button" class="share-add-btn" aria-label="add">+</button>`;
        stepperEl.querySelector('.share-add-btn').addEventListener('click', (ev)=>{
          ev.stopPropagation();
          setVal(defaultShareValue());
        });
      }
    };

    const setVal = (v)=>{
      stepperEl.dataset.value = clampShare(v);
      renderControl();
      updateSelectAllToolbarState();
    };

    // Tap anywhere on the row (name/checkmark area) to quick-toggle just
    // THIS member: 0 -> their default share, back to 0 on a second tap.
    // Clicks on the +/- (or the add button) stop propagation above, so
    // this only fires for taps outside the stepper control.
    row.addEventListener('click', ()=>{
      const current = Number(stepperEl.dataset.value || 0);
      setVal(current > 0 ? 0 : defaultShareValue());
    });

    renderControl();
    row._setShareValue = setVal;
  });

  // Select-all toolbar button is a real toggle: tap once to fill everyone
  // in at their default share, tap again (once everyone's selected) to
  // clear everyone back out.
  const selectAllBtn = document.getElementById('selectAllMembers');
  if(selectAllBtn){
    selectAllBtn.addEventListener('click', ()=>{
      const allActive = rows.length > 0 && rows.every(r => Number(r.querySelector('.share-stepper').dataset.value) > 0);
      rows.forEach(row=>{
        const nextVal = allActive ? 0 : defaultShareValue();
        row._setShareValue(nextVal);
      });
    });
  }

  const clearAllBtn = document.getElementById('clearAllShares');
  if(clearAllBtn){
    clearAllBtn.addEventListener('click', ()=>{
      rows.forEach(row => row._setShareValue(0));
    });
  }

  updateSelectAllToolbarState();
}

function updateSelectAllToolbarState(){
  const selectAllBtn = document.getElementById('selectAllMembers');
  if(!selectAllBtn) return;
  const rows = Array.from(document.querySelectorAll('#expenseMembersCheck .share-row[data-id]'));
  const allActive = rows.length > 0 && rows.every(r => Number(r.querySelector('.share-stepper').dataset.value) > 0);
  selectAllBtn.classList.toggle('active', allActive);
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
    const shareRows = document.querySelectorAll('#expenseMembersCheck .share-row[data-id]');
    shareRows.forEach(row=>{
      const mid = row.dataset.id;
      let v = 0;
      if(e.shares && e.shares[mid] != null){
        v = Number(e.shares[mid]);
      } else if(e.includedMembers && e.includedMembers.includes(mid)){
        // pre-shares expense: approximate its old count-based split
        v = Number((members[mid] && members[mid].count) || 1);
      }
      if(row._setShareValue) row._setShareValue(v);
    });
    updateSelectAllToolbarState();
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

  const shares = {};
  document.querySelectorAll('#expenseMembersCheck .share-row[data-id]').forEach(row=>{
    const v = Number(row.querySelector('.share-stepper').dataset.value || 0);
    if(v > 0) shares[row.dataset.id] = v;
  });
  const included = Object.keys(shares);
  const editId = document.getElementById('expenseEditId').value;

  if(!amount || amount <= 0){ showToast(t('toastAmountNeeded')); return; }
  if(!paidBy){ showToast(t('toastPaidByNeeded')); return; }
  if(included.length === 0){ showToast(t('toastMembersNeeded')); return; }

  const data = { amount, paidBy, includedMembers: included, shares, date, note, paymentMethod };
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
    const da = ea.date || '';
    const db = eb.date || '';
    if(db !== da) return db.localeCompare(da); // newest date first
    const ca = Number(ea.createdAt) || 0;
    const cb = Number(eb.createdAt) || 0;
    return cb - ca; // same date: most recently added first
  });
  let total = 0;
  Object.values(expenses).forEach(e => total += Number(e.amount));
  document.getElementById('totalExpense').textContent = fmt(total);
  const expenseEntriesEl = document.getElementById('totalExpenseEntries');
  if(expenseEntriesEl) expenseEntriesEl.textContent = Object.keys(expenses).length;
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
    const usesCustomShares = !!e.shares;
    const totalWeight = included.reduce((sum, mid) => sum + expenseWeight(e, mid), 0);
    const perUnit = totalWeight > 0 ? Number(e.amount) / totalWeight : 0;

    const breakdownRows = included.map(mid=>{
      const m = members[mid];
      const w = expenseWeight(e, mid);
      const share = perUnit * w;
      const isPayer = mid === e.paidBy;
      const weightLabel = usesCustomShares
        ? `${formatShareValue(w)} ${t('shareUnitLabel')}`
        : `${m.count} ${t('personWord')}`;
      return `
        <div class="breakdown-row">
          <span>${m.name} (${weightLabel})${isPayer ? ' 💰' : ''}</span>
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
                  <div class="item-sub">${payer} ${t('paidWord')}${e.date ? ' • ' + e.date : ''} ${e.paymentMethod ? ' • ' + (e.paymentMethod === 'cash' ? t('paymentCashLabel') : t('paymentOnlineLabel')) : ''}</div>
                </div>
          <div class="item-trail">
            <div class="item-amount">${fmt(e.amount)}</div>
          </div>
        </div>
        <div class="breakdown-box">
          <div class="breakdown-head">${t('perPersonPrefix')} ${formatShareValue(totalWeight)} ${t('perPersonMiddle')} ${fmt(perUnit)}</div>
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
  }).sort((a,b)=>{
    const ea = expenses[a] || {}, eb = expenses[b] || {};
    const da = ea.date || '', db = eb.date || '';
    if(db !== da) return db.localeCompare(da);
    return (Number(eb.createdAt)||0) - (Number(ea.createdAt)||0);
  });
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
    const totalWeight = included.reduce((s, mid) => s + expenseWeight(r, mid), 0);
    const perUnit = totalWeight > 0 ? Number(r.amount) / totalWeight : 0;
    included.forEach(mid=>{
      totals[mid] = (totals[mid] || 0) + perUnit * expenseWeight(r, mid);
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

    const totalWeight = included.reduce((sum, id) => sum + expenseWeight(e, id), 0);
    if(totalWeight <= 0) return;

    const perUnit = Number(e.amount) / totalWeight;

    included.forEach(id=>{
      const share = perUnit * expenseWeight(e, id);
      balance[id] = (balance[id] || 0) - share;
    });

    if(members[e.paidBy]){
      balance[e.paidBy] = (balance[e.paidBy] || 0) + Number(e.amount);
    }
  });

  // Direct settle-up payments between members reduce what's owed:
  // "from" already handed over the money, so their debt shrinks;
  // "to" already received it, so what they're owed shrinks.
  Object.values(payments).forEach(p=>{
    if(!members[p.from] || !members[p.to]) return;
    const amt = Number(p.amount) || 0;
    balance[p.from] = (balance[p.from] || 0) + amt;
    balance[p.to] = (balance[p.to] || 0) - amt;
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
          <button class="btn-mark-paid" onclick="quickRecordPayment('${txn.from}','${txn.to}',${txn.amount})">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span data-i18n="markPaidBtn">${t('markPaidBtn')}</span>
          </button>
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

// ---------------- Payments (record "I paid this to this person") ----------------
function populatePaymentForm(){
  const fromSel = document.getElementById('paymentFrom');
  const toSel = document.getElementById('paymentTo');
  if(!fromSel || !toSel) return;
  const ids = Object.keys(members);
  const options = ids.map(id => `<option value="${id}">${members[id].name}</option>`).join('')
    || `<option value="">${t('memberSelectPlaceholder')}</option>`;
  const prevFrom = fromSel.value, prevTo = toSel.value;
  fromSel.innerHTML = options;
  toSel.innerHTML = options;
  if(ids.includes(prevFrom)) fromSel.value = prevFrom;
  if(ids.includes(prevTo)) toSel.value = prevTo;
}

function openPaymentModal(id, prefill){
  if(Object.keys(members).length < 2){
    showToast(t('addMemberFirst'));
    return;
  }
  populatePaymentForm();
  document.getElementById('paymentModalTitle').textContent = id ? t('paymentModalTitleEdit') : t('paymentModalTitleNew');
  document.getElementById('paymentEditId').value = id || '';
  document.getElementById('paymentDeleteBtn').style.display = id ? 'block' : 'none';

  if(id){
    const p = payments[id];
    document.getElementById('paymentFrom').value = p.from;
    document.getElementById('paymentTo').value = p.to;
    document.getElementById('paymentAmount').value = p.amount;
    document.getElementById('paymentDate').value = p.date;
    document.getElementById('paymentNote').value = p.note || '';
  } else {
    document.getElementById('paymentAmount').value = (prefill && prefill.amount) ? Math.round(prefill.amount * 100) / 100 : '';
    document.getElementById('paymentDate').value = new Date().toISOString().slice(0,10);
    document.getElementById('paymentNote').value = '';
    if(prefill && prefill.from) document.getElementById('paymentFrom').value = prefill.from;
    if(prefill && prefill.to) document.getElementById('paymentTo').value = prefill.to;
  }
  openModal('paymentModal');
}

const recordPaymentBtn = document.getElementById('recordPaymentBtn');
if(recordPaymentBtn) recordPaymentBtn.addEventListener('click', ()=> openPaymentModal(null));

const paymentSaveBtn = document.getElementById('paymentSaveBtn');
if(paymentSaveBtn) paymentSaveBtn.addEventListener('click', ()=>{
  const from = document.getElementById('paymentFrom').value;
  const to = document.getElementById('paymentTo').value;
  const amount = parseFloat(document.getElementById('paymentAmount').value);
  const date = document.getElementById('paymentDate').value;
  const note = document.getElementById('paymentNote').value.trim();
  const editId = document.getElementById('paymentEditId').value;

  if(!from || !to){ showToast(t('toastPaidByNeeded')); return; }
  if(from === to){ showToast(t('toastFromToSame')); return; }
  if(!amount || amount <= 0){ showToast(t('toastAmountNeeded')); return; }

  const data = { from, to, amount, date, note };
  if(editId){
    paymentsRef().child(editId).update(data);
    showToast(t('toastPaymentUpdated'));
  } else {
    data.createdAt = firebase.database.ServerValue.TIMESTAMP;
    paymentsRef().push(data);
    showToast(t('toastPaymentAdded'));
  }
  closeModal('paymentModal');
});

const paymentDeleteBtn = document.getElementById('paymentDeleteBtn');
if(paymentDeleteBtn) paymentDeleteBtn.addEventListener('click', ()=>{
  const editId = document.getElementById('paymentEditId').value;
  if(!editId) return;
  if(confirm(t('confirmPaymentDelete'))){
    paymentsRef().child(editId).remove();
    closeModal('paymentModal');
    showToast(t('toastPaymentDeleted'));
  }
});

// One-tap "mark as paid" straight from a suggested settlement row
function quickRecordPayment(fromId, toId, amount){
  if(!confirm(t('confirmMarkPaid'))) return;
  paymentsRef().push({
    from: fromId,
    to: toId,
    amount: Math.round(amount * 100) / 100,
    date: new Date().toISOString().slice(0,10),
    note: '',
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  showToast(t('toastPaymentAdded'));
}

function renderPayments(){
  const wrap = document.getElementById('paymentsList');
  if(!wrap) return;
  const ids = Object.keys(payments).sort((a,b)=>{
    const pa = payments[a] || {};
    const pb = payments[b] || {};
    const da = pa.date || '';
    const db = pb.date || '';
    if(db !== da) return db.localeCompare(da); // newest date first
    return (Number(pb.createdAt)||0) - (Number(pa.createdAt)||0);
  });
  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noPayments')}</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const p = payments[id];
    const fromName = members[p.from] ? members[p.from].name : '?';
    const toName = members[p.to] ? members[p.to].name : '?';
    return `
      <div class="item-card" onclick="openPaymentModal('${id}')">
        <div class="item-avatar" style="background:${colorFor(id)}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
        </div>
        <div class="item-body">
          <div class="item-title">${fromName} → ${toName}</div>
          <div class="item-sub">${p.date || ''}${p.note ? ' • ' + p.note : ''}</div>
        </div>
        <div class="item-trail">
          <div class="item-amount get">${fmt(p.amount)}</div>
        </div>
      </div>`;
  }).join('');
}

// ---------------- PWA: service worker ----------------
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });

  // When a newly-deployed service worker takes over (because it called
  // skipWaiting + clients.claim in sw.js), the page it's currently
  // controlling is still running old cached JS in memory. Reload once,
  // automatically, so the update actually takes effect right away
  // instead of needing a manual hard refresh / cache clear.
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
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
