// ============================================================
// KHARCHA HISAB - app.js
// Data model:
//   /members/{id}  -> { name, count }
//   /expenses/{id} -> { amount, paidBy, includedMembers:[ids], date, note }
// ============================================================

let members = {};   // id -> {name, count}
let expenses = {};  // id -> {amount, paidBy, includedMembers, date, note}

const AVATAR_COLORS = ['#0b8457','#2563eb','#c0392b','#9333ea','#d97706','#0891b2'];

function colorFor(id){
  let h = 0;
  for(const c of id) h = (h*31 + c.charCodeAt(0)) % 1000;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

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
    openExpenseModal(null);
  }
});

// ---------------- Firebase listeners (trip-scoped) ----------------
function attachTripListeners(){
  if(!currentTripId) return;
  membersRef().on('value', membersListener);
  expensesRef().on('value', expensesListener);
}

function detachTripListeners(){
  members = {};
  expenses = {};
  if(currentTripId){
    membersRef().off('value', membersListener);
    expensesRef().off('value', expensesListener);
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
  const note = document.getElementById('expenseNote').value.trim();
  const included = Array.from(document.querySelectorAll('.member-check:checked')).map(cb=>cb.value);
  const editId = document.getElementById('expenseEditId').value;

  if(!amount || amount <= 0){ showToast(t('toastAmountNeeded')); return; }
  if(!paidBy){ showToast(t('toastPaidByNeeded')); return; }
  if(included.length === 0){ showToast(t('toastMembersNeeded')); return; }

  const data = { amount, paidBy, includedMembers: included, date, note };
  if(editId){
    expensesRef().child(editId).update(data);
    showToast(t('toastExpenseUpdated'));
  } else {
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
  const ids = Object.keys(expenses).sort((a,b)=> (expenses[b].date||'').localeCompare(expenses[a].date||''));
  let total = 0;
  Object.values(expenses).forEach(e => total += Number(e.amount));
  document.getElementById('totalExpense').textContent = fmt(total);
  updateAvgPerPerson(total);

  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noExpensesShort')}</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const e = expenses[id];
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

    return `
      <div class="item-card expense-card">
        <div class="item-card-top" onclick="openExpenseModal('${id}')">
          <div class="item-avatar" style="background:${colorFor(e.paidBy||id)}">${payer.charAt(0)}</div>
          <div class="item-body">
            <div class="item-title">${e.note ? e.note : payer + ' ' + t('paidSuffix')}</div>
            <div class="item-sub">${payer} ${t('paidWord')}${e.date ? ' • ' + e.date : ''}</div>
          </div>
          <div class="item-trail">
            <div class="item-amount">${fmt(e.amount)}</div>
          </div>
        </div>
        <div class="breakdown-box">
          <div class="breakdown-head">${t('perPersonPrefix')} ${totalIndividuals} ${t('perPersonMiddle')} ${fmt(perPerson)}</div>
          ${breakdownRows}
        </div>
      </div>`;
  }).join('');
}

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
let deferredPrompt;
const pwaInstallBtn = document.getElementById('pwaInstallBtn');
const pwaInstallBtn2 = document.getElementById('pwaInstallBtn2');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if(pwaInstallBtn) pwaInstallBtn.style.display = 'flex';
  if(pwaInstallBtn2) pwaInstallBtn2.style.display = 'flex';
});

if(pwaInstallBtn){
  pwaInstallBtn.addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    deferredPrompt = null;
    pwaInstallBtn.style.display = 'none';
    if(pwaInstallBtn2) pwaInstallBtn2.style.display = 'none';
  });
}

if(pwaInstallBtn2){
  pwaInstallBtn2.addEventListener('click', async () => {
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response: ${outcome}`);
    deferredPrompt = null;
    pwaInstallBtn.style.display = 'none';
    if(pwaInstallBtn2) pwaInstallBtn2.style.display = 'none';
  });
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if(pwaInstallBtn) pwaInstallBtn.style.display = 'none';
  if(pwaInstallBtn2) pwaInstallBtn2.style.display = 'none';
});
