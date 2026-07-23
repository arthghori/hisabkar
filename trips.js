// ============================================================
// trips.js - Trip picker + user-scoped trip access + sharing
// Data model:
//   /trips/{tripId} -> { name, startDate, createdAt, ownerMobile, code }
//   /trips/{tripId}/participants/{mobile} -> { name, joinedAt }
//   /trips/{tripId}/members/{id}  -> { name, count }   (expense-split groups)
//   /trips/{tripId}/expenses/{id} -> { amount, paidBy, includedMembers, date, note }
//   /trips/{tripId}/payments/{id} -> { from, to, amount, date, note }  (settle-up records)
//   /userTrips/{mobile}/{tripId} -> true   (index: which trips a user can access)
//   /tripCodes/{code} -> tripId            (index: join by share code)
// ============================================================

let trips = {};          // tripId -> trip meta (name, startDate, code, ownerMobile...)
let userTripIds = [];    // tripIds current user has access to
let currentTripId = localStorage.getItem('kh_current_trip') || null;
let userTripsListenerRef = null;

function membersRef(){ return db.ref('trips/' + currentTripId + '/members'); }
function expensesRef(){ return db.ref('trips/' + currentTripId + '/expenses'); }
function notesRef(){ return db.ref('trips/' + currentTripId + '/notes'); }
function paymentsRef(){ return db.ref('trips/' + currentTripId + '/payments'); }

function genTripCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ---------------- Screen switching ----------------
function showTripPicker(){
  currentTripId = null;
  localStorage.removeItem('kh_current_trip');
  document.getElementById('authRoot').style.display = 'none';
  document.getElementById('mainAppRoot').style.display = 'none';
  document.getElementById('tripPickerRoot').style.display = 'flex';
  if(typeof detachTripListeners === 'function') detachTripListeners();
  loadUserTrips();
  const leaveBtn = document.getElementById('leaveTripBtn');
  if(leaveBtn) leaveBtn.style.display = 'none';
}

function showMainApp(tripId){
  currentTripId = tripId;
  localStorage.setItem('kh_current_trip', tripId);
  document.getElementById('authRoot').style.display = 'none';
  document.getElementById('tripPickerRoot').style.display = 'none';
  document.getElementById('mainAppRoot').style.display = 'flex';
  document.getElementById('currentTripName').textContent = trips[tripId] ? trips[tripId].name : t('appTitle');
  document.getElementById('currentTripNote').textContent = trips[tripId] && trips[tripId].note ? trips[tripId].note : '';
  if(typeof attachTripListeners === 'function') attachTripListeners();
  const leaveBtn = document.getElementById('leaveTripBtn');
  if(leaveBtn){
    if(currentUser && trips[tripId] && trips[tripId].ownerMobile !== currentUser.mobile) leaveBtn.style.display = 'inline-flex';
    else leaveBtn.style.display = 'none';
  }
}

document.getElementById('backToTrips').addEventListener('click', showTripPicker);

// Leave trip (remove access for current user only, on this account —
// does not touch the trip's data or other participants' access)
function leaveTrip(id, ev){
  if(ev) ev.stopPropagation();
  if(!id || !currentUser) return;
  const trip = trips[id];
  if(trip && trip.ownerMobile === currentUser.mobile){
    showToast(t('toastOwnerCannotLeave') || 'Owner cannot leave the trip — use delete');
    return;
  }
  if(confirm(t('confirmLeaveTrip') || 'શું તમે આ ટ્રિપ છોડી દઇશું? આ ડિવાઇસ/એકાઉન્ટ થી ટ્રિપ દૂર થઈ જશે')){
    db.ref('userTrips/' + currentUser.mobile + '/' + id).remove();
    db.ref('trips/' + id + '/participants/' + currentUser.mobile).remove();
    if(currentTripId === id) showTripPicker();
    showToast(t('toastLeftTrip') || 'You left the trip');
  }
}

document.getElementById('leaveTripBtn').addEventListener('click', ()=> leaveTrip(currentTripId));

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  if(confirm(t('confirmLogout'))) logout();
});

// ---------------- Load trips the current user can access ----------------
function loadUserTrips(){
  if(!currentUser) return;
  if(userTripsListenerRef) userTripsListenerRef.off();
  userTripsListenerRef = db.ref('userTrips/' + currentUser.mobile);
  userTripsListenerRef.on('value', snap=>{
    userTripIds = Object.keys(snap.val() || {});
    fetchTripsMeta();
  });
}

function fetchTripsMeta(){
  if(userTripIds.length === 0){
    trips = {};
    renderTripList();
    return;
  }
  Promise.all(userTripIds.map(id => db.ref('trips/' + id).once('value'))).then(snaps=>{
    trips = {};
    snaps.forEach((snap, idx)=>{
      if(snap.exists()) trips[userTripIds[idx]] = snap.val();
    });
    renderTripList();
    if(currentTripId && trips[currentTripId]){
      document.getElementById('currentTripName').textContent = trips[currentTripId].name;
    }
  });
}

// ---------------- Add trip ----------------
document.getElementById('fabTrip').addEventListener('click', ()=>{
  document.getElementById('tripEditId').value = '';
  document.getElementById('tripName').value = '';
  document.getElementById('tripStartDate').value = new Date().toISOString().slice(0,10);
  openModal('tripModal');
});

document.getElementById('tripSaveBtn').addEventListener('click', ()=>{
  const name = document.getElementById('tripName').value.trim();
  const startDate = document.getElementById('tripStartDate').value;
  const note = (document.getElementById('tripNote') || {value:''}).value.trim();

  if(!name){ showToast(t('toastTripNameNeeded')); return; }
  if(!currentUser){ showToast(t('toastLoginFirst')); return; }

  const code = genTripCode();
  const newRef = db.ref('trips').push();
  const tripId = newRef.key;
  const data = {
    name, startDate,
    createdAt: Date.now(),
    ownerMobile: currentUser.mobile,
    code
  };
  if(note) data.note = note;
  newRef.set(data).then(()=>{
    db.ref('trips/' + tripId + '/participants/' + currentUser.mobile).set({ name: currentUser.name, joinedAt: Date.now() });
    db.ref('userTrips/' + currentUser.mobile + '/' + tripId).set(true);
    db.ref('tripCodes/' + code).set(tripId);
    closeModal('tripModal');
    showToast(t('toastTripAdded'));
  });
});

// ---------------- Join trip via code ----------------
document.getElementById('joinTripBtn').addEventListener('click', ()=>{
  const code = document.getElementById('joinTripCode').value.trim().toUpperCase();
  if(!code){ showToast(t('toastCodeNeeded')); return; }

  db.ref('tripCodes/' + code).once('value').then(snap=>{
    if(!snap.exists()){ showToast(t('toastCodeInvalid')); return; }
    const tripId = snap.val();
    db.ref('trips/' + tripId + '/participants/' + currentUser.mobile).set({ name: currentUser.name, joinedAt: Date.now() });
    db.ref('userTrips/' + currentUser.mobile + '/' + tripId).set(true).then(()=>{
      document.getElementById('joinTripCode').value = '';
      showToast(t('toastJoinSuccess'));
    });
  });
});

// Auto-fill join code from a shared link: ?code=XXXXXX
(function prefillCodeFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if(code){
    setTimeout(()=>{
      const input = document.getElementById('joinTripCode');
      if(input) input.value = code.toUpperCase();
    }, 300);
  }
})();

// ---------------- Delete trip (owner only) ----------------
function deleteTrip(id, ev){
  ev.stopPropagation();
  const trip = trips[id];
  if(!trip) return;
  if(!currentUser || trip.ownerMobile !== currentUser.mobile){
    showToast(t('toastOnlyOwnerDelete'));
    return;
  }
  if(confirm(t('confirmTripDelete'))){
    db.ref('trips/' + id + '/participants').once('value').then(snap=>{
      const participants = snap.val() || {};
      Object.keys(participants).forEach(mobile=>{
        db.ref('userTrips/' + mobile + '/' + id).remove();
      });
      if(trip.code) db.ref('tripCodes/' + trip.code).remove();
      db.ref('trips/' + id).remove();
      showToast(t('toastTripDeleted'));
    });
  }
}

// ---------------- Share trip via WhatsApp ----------------
function shareTripLink(){
  if(!currentTripId || !trips[currentTripId]) return;
  const trip = trips[currentTripId];
  const link = window.location.origin + window.location.pathname + '?code=' + trip.code;
  const msg = `${t('shareTripMsgPrefix')} "${trip.name}"\n${t('shareTripCodeLabel')}: ${trip.code}\n${link}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}
document.getElementById('shareTripBtn').addEventListener('click', shareTripLink);

// ---------------- Render trip list ----------------
function renderTripList(){
  const wrap = document.getElementById('tripsList');
  const ids = Object.keys(trips).sort((a,b)=> (trips[b].createdAt||0) - (trips[a].createdAt||0));

  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noTrips')}</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const trip = trips[id];
    const isOwner = currentUser && trip.ownerMobile === currentUser.mobile;
    return `
      <div class="item-card" onclick="showMainApp('${id}')">
        <div class="item-avatar" style="background:${colorFor(id)}">${trip.name.charAt(0)}</div>
        <div class="item-body">
          <div class="item-title">${trip.name}</div>
          <div class="item-sub">${trip.startDate || ''} • ${t('codeLabel')}: ${trip.code || ''}${trip.note ? ' • ' + trip.note : ''}</div>
        </div>
        ${isOwner ? `
        <button class="icon-btn trip-delete" onclick="deleteTrip('${id}', event)" aria-label="Delete trip">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>
        </button>` : `
        <button class="icon-btn trip-leave" onclick="leaveTrip('${id}', event)" aria-label="Leave trip" title="Leave trip (this device only)">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>`}
      </div>`;
  }).join('');
}

// ---------------- Boot (called by auth.js only after session is verified) ----------------
function bootTripFlow(){
  document.getElementById('authRoot').style.display = 'none';

  if(currentTripId){
    document.getElementById('mainAppRoot').style.display = 'flex';
    document.getElementById('tripPickerRoot').style.display = 'none';
    document.getElementById('currentTripName').textContent = t('appTitle');
    if(typeof attachTripListeners === 'function') attachTripListeners();
    db.ref('trips/' + currentTripId).once('value').then(snap=>{
      if(!snap.exists()) showTripPicker();
      else document.getElementById('currentTripName').textContent = snap.val().name;
    });
    loadUserTrips();
  } else {
    document.getElementById('tripPickerRoot').style.display = 'flex';
    document.getElementById('mainAppRoot').style.display = 'none';
    loadUserTrips();
  }
}