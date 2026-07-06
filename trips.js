// ============================================================
// trips.js - Trip picker + trip-scoped data refs
// Data model:
//   /trips/{tripId} -> { name, startDate, createdAt }
//   /trips/{tripId}/members/{id}  -> { name, count }
//   /trips/{tripId}/expenses/{id} -> { amount, paidBy, includedMembers, date, note }
// ============================================================

let trips = {};
let currentTripId = localStorage.getItem('kh_current_trip') || null;

function membersRef(){ return db.ref('trips/' + currentTripId + '/members'); }
function expensesRef(){ return db.ref('trips/' + currentTripId + '/expenses'); }

// ---------------- Screen switching ----------------
function showTripPicker(){
  currentTripId = null;
  localStorage.removeItem('kh_current_trip');
  document.getElementById('mainAppRoot').style.display = 'none';
  document.getElementById('tripPickerRoot').style.display = 'flex';
  // Detach trip-scoped listeners so stale data doesn't leak into the next trip
  if(typeof detachTripListeners === 'function') detachTripListeners();
}

function showMainApp(tripId){
  currentTripId = tripId;
  localStorage.setItem('kh_current_trip', tripId);
  document.getElementById('tripPickerRoot').style.display = 'none';
  document.getElementById('mainAppRoot').style.display = 'flex';
  document.getElementById('currentTripName').textContent = trips[tripId] ? trips[tripId].name : t('appTitle');
  if(typeof attachTripListeners === 'function') attachTripListeners();
}

document.getElementById('backToTrips').addEventListener('click', showTripPicker);

// ---------------- Trip CRUD ----------------
db.ref('trips').on('value', snap=>{
  trips = snap.val() || {};
  renderTripList();
  // keep main app title in sync if currently open
  if(currentTripId && trips[currentTripId]){
    document.getElementById('currentTripName').textContent = trips[currentTripId].name;
  }
});

document.getElementById('fabTrip').addEventListener('click', ()=>{
  document.getElementById('tripEditId').value = '';
  document.getElementById('tripName').value = '';
  document.getElementById('tripStartDate').value = new Date().toISOString().slice(0,10);
  openModal('tripModal');
});

document.getElementById('tripSaveBtn').addEventListener('click', ()=>{
  const name = document.getElementById('tripName').value.trim();
  const startDate = document.getElementById('tripStartDate').value;

  if(!name){ showToast(t('toastTripNameNeeded')); return; }

  const data = { name, startDate, createdAt: Date.now() };
  const newRef = db.ref('trips').push();
  newRef.set(data);
  closeModal('tripModal');
  showToast(t('toastTripAdded'));
});

function deleteTrip(id, ev){
  ev.stopPropagation();
  if(confirm(t('confirmTripDelete'))){
    db.ref('trips/' + id).remove();
    showToast(t('toastTripDeleted'));
  }
}

function renderTripList(){
  const wrap = document.getElementById('tripsList');
  const ids = Object.keys(trips).sort((a,b)=> (trips[b].createdAt||0) - (trips[a].createdAt||0));

  if(ids.length === 0){
    wrap.innerHTML = `<p class="empty-hint">${t('noTrips')}</p>`;
    return;
  }
  wrap.innerHTML = ids.map(id=>{
    const trip = trips[id];
    return `
      <div class="item-card" onclick="showMainApp('${id}')">
        <div class="item-avatar" style="background:${colorFor(id)}">${trip.name.charAt(0)}</div>
        <div class="item-body">
          <div class="item-title">${trip.name}</div>
          <div class="item-sub">${trip.startDate || ''}</div>
        </div>
        <button class="icon-btn trip-delete" onclick="deleteTrip('${id}', event)" aria-label="Delete trip">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></svg>
        </button>
      </div>`;
  }).join('');
}

// ---------------- Boot ----------------
document.addEventListener('DOMContentLoaded', ()=>{
  if(currentTripId){
    // will show once trips data confirms it still exists; fallback to picker if not found after a short wait
    document.getElementById('mainAppRoot').style.display = 'flex';
    document.getElementById('tripPickerRoot').style.display = 'none';
    document.getElementById('currentTripName').textContent = t('appTitle');
    if(typeof attachTripListeners === 'function') attachTripListeners();
    db.ref('trips/' + currentTripId).once('value').then(snap=>{
      if(!snap.exists()) showTripPicker();
      else document.getElementById('currentTripName').textContent = snap.val().name;
    });
  } else {
    document.getElementById('tripPickerRoot').style.display = 'flex';
    document.getElementById('mainAppRoot').style.display = 'none';
  }
});
