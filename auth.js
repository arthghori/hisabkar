// ============================================================
// auth.js - Login / Register with proper session management
// (Realtime Database based - no Firebase Auth, no backend server)
//
// Data model:
//   /users/{mobile}    -> { name, mobile, salt, passwordHash, createdAt }
//   /sessions/{token}  -> { mobile, createdAt, expiresAt }
//
// Security notes (read this):
// - Passwords are NEVER stored or sent in plain text. Each password is
//   combined with a random per-user salt and hashed with SHA-256 before
//   it ever reaches the database. Only the hash + salt are stored.
// - Login does not store the password/user object in localStorage.
//   Instead, a random session token is created and stored in
//   /sessions/{token} in the database. Only that opaque token is kept
//   on the device. On every app load, the token is verified against
//   the database (exists? not expired?) before the person is treated
//   as logged in.
// - Logging out deletes the session token from the database, so a
//   copied/leaked token stops working immediately.
// - Sessions expire after 30 days; using the app refreshes the expiry.
// - LIMITATION: because there is no Firebase Authentication / backend
//   server here, the database rules cannot cryptographically verify
//   "who" is making a request the way a real backend could. Anyone who
//   has the Firebase config could still technically read/write the
//   database if the rules allow it. This setup is best-effort hardening
//   suitable for a private/trusted-group app - NOT a substitute for
//   Firebase Authentication in a public production app.
// ============================================================

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TOKEN_KEY = 'kh_session_token';

let currentUser = null; // { mobile, name } - set only after session is verified

// ---------------- Crypto helpers ----------------
async function sha256Hex(text){
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength){
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeMobile(m){
  return (m || '').replace(/\D/g, '');
}

// ---------------- Screen helpers ----------------
function showAuthScreen(){
  document.getElementById('authRoot').style.display = 'flex';
  document.getElementById('tripPickerRoot').style.display = 'none';
  document.getElementById('mainAppRoot').style.display = 'none';
}

// ---------------- Session creation / validation ----------------
async function createSession(mobile){
  const token = randomHex(24);
  const now = Date.now();
  await db.ref('sessions/' + token).set({
    mobile,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS
  });
  localStorage.setItem(SESSION_TOKEN_KEY, token);
  return token;
}

async function destroySession(){
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_TOKEN_KEY);
  if(token){
    try{ await db.ref('sessions/' + token).remove(); } catch(e){ /* ignore */ }
  }
}

async function initSession(){
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if(!token){ showAuthScreen(); return; }

  try{
    const sessionSnap = await db.ref('sessions/' + token).once('value');
    if(!sessionSnap.exists()){
      localStorage.removeItem(SESSION_TOKEN_KEY);
      showAuthScreen();
      return;
    }
    const session = sessionSnap.val();
    if(!session.expiresAt || session.expiresAt < Date.now()){
      await db.ref('sessions/' + token).remove();
      localStorage.removeItem(SESSION_TOKEN_KEY);
      showAuthScreen();
      return;
    }

    const userSnap = await db.ref('users/' + session.mobile).once('value');
    if(!userSnap.exists()){
      await db.ref('sessions/' + token).remove();
      localStorage.removeItem(SESSION_TOKEN_KEY);
      showAuthScreen();
      return;
    }

    currentUser = { mobile: session.mobile, name: userSnap.val().name };
    document.getElementById('authRoot').style.display = 'none';
    const nameEl = document.getElementById('userNameDisplay');
    if(nameEl) nameEl.textContent = currentUser.name;

    // Sliding expiry: extend the session on active use
    db.ref('sessions/' + token + '/expiresAt').set(Date.now() + SESSION_DURATION_MS);

    if(typeof bootTripFlow === 'function') bootTripFlow();
  } catch(err){
    showAuthScreen();
  }
}

async function afterLogin(user){
  currentUser = user;
  await createSession(user.mobile);
  document.getElementById('authRoot').style.display = 'none';
  const nameEl = document.getElementById('userNameDisplay');
  if(nameEl) nameEl.textContent = user.name;
  if(typeof bootTripFlow === 'function') bootTripFlow();
}

async function logout(){
  if(typeof detachTripListeners === 'function') detachTripListeners();
  await destroySession();
  currentUser = null;
  localStorage.removeItem('kh_current_trip');
  showAuthScreen();
}

// ---------------- Tab switching ----------------
document.querySelectorAll('.auth-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.auth-tab').forEach(b=>b.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.authMode;
    document.getElementById('loginForm').style.display = mode === 'login' ? 'flex' : 'none';
    document.getElementById('registerForm').style.display = mode === 'register' ? 'flex' : 'none';
  });
});

// ---------------- Simple client-side lockout (basic abuse protection) ----------------
let loginFailCount = 0;
let lockoutUntil = 0;

function isLockedOut(){
  return Date.now() < lockoutUntil;
}
function registerLoginFailure(){
  loginFailCount++;
  if(loginFailCount >= 5){
    lockoutUntil = Date.now() + 30000; // 30s lockout after 5 bad attempts
    loginFailCount = 0;
  }
}

// ---------------- Register ----------------
document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('regName').value.trim();
  const mobile = sanitizeMobile(document.getElementById('regMobile').value);
  const password = document.getElementById('regPassword').value;
  const btn = document.getElementById('registerBtn');

  if(!name){ showToast(t('toastNameNeeded')); return; }
  if(mobile.length < 10){ showToast(t('toastMobileInvalid')); return; }
  if(!password || password.length < 4){ showToast(t('toastPasswordShort')); return; }

  btn.disabled = true;
  try{
    const existing = await db.ref('users/' + mobile).once('value');
    if(existing.exists()){ showToast(t('toastMobileExists')); return; }

    const salt = randomHex(16);
    const passwordHash = await sha256Hex(password + salt);

    await db.ref('users/' + mobile).set({ name, mobile, salt, passwordHash, createdAt: Date.now() });
    showToast(t('toastRegisterSuccess'));
    await afterLogin({ mobile, name });
  } catch(err){
    showToast(t('toastGenericError'));
  } finally{
    btn.disabled = false;
  }
});

// ---------------- Login ----------------
document.getElementById('loginBtn').addEventListener('click', async ()=>{
  if(isLockedOut()){ showToast(t('toastTooManyAttempts')); return; }

  const mobile = sanitizeMobile(document.getElementById('loginMobile').value);
  const password = document.getElementById('loginPassword').value;
  const btn = document.getElementById('loginBtn');

  if(mobile.length < 10 || !password){ showToast(t('toastLoginFillAll')); return; }

  btn.disabled = true;
  try{
    const snap = await db.ref('users/' + mobile).once('value');
    if(!snap.exists()){ registerLoginFailure(); showToast(t('toastUserNotFound')); return; }

    const user = snap.val();
    const hash = await sha256Hex(password + user.salt);
    if(hash !== user.passwordHash){ registerLoginFailure(); showToast(t('toastWrongPassword')); return; }

    loginFailCount = 0;
    showToast(t('toastLoginSuccess'));
    await afterLogin({ mobile, name: user.name });
  } catch(err){
    showToast(t('toastGenericError'));
  } finally{
    btn.disabled = false;
  }
});

// ---------------- Boot ----------------
document.addEventListener('DOMContentLoaded', ()=>{
  initSession();
});
