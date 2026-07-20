<div align="center">

<img src="icon-512.png" width="88" alt="Kharcha Hisab logo" />

# ખર્ચા હિસાબ — Kharcha Hisab

**A bilingual (Gujarati / English) expense-splitting PWA for trips and groups.**

Track who paid, who owes, and settle up — installable on any phone, works offline, no backend server required.

[![PWA](https://img.shields.io/badge/PWA-installable-0B8457?style=flat-square)](#)
[![Firebase](https://img.shields.io/badge/Firebase-Realtime%20DB-FFCA28?style=flat-square&logo=firebase&logoColor=black)](#)
[![Vanilla JS](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](#)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](#license)

</div>

---

## ✨ Features

- 🧾 **Trips** — create a trip, share it with a 6-character join code or a WhatsApp link
- 👥 **Members** — add members with how many people each one represents (e.g. a family of 4)
- 💸 **Expenses** — log who paid, how much, and who it's split among; edit or delete anytime
- ⚖️ **Settlement** — automatic "who owes whom" calculation, minimized into the fewest possible payments
- 📊 **Balance view** — per-member running balance at a glance
- 📤 **Export & share** — download expenses as CSV/TXT, or share the settlement on WhatsApp
- 🌐 **Gujarati ⇄ English** — one-tap language toggle across the whole app
- 📱 **Installable PWA** — add to home screen, works offline, syncs when back online
- 🔐 **Mobile number + password auth** — session-token based, no third-party login required

## 🖼️ Screenshots

> _Add screenshots here — e.g. `docs/home.png`, `docs/expenses.png`, `docs/settlement.png`_

```
| Home / Settlement | Members | Add Expense |
|:---:|:---:|:---:|
| ![home](docs/home.png) | ![members](docs/members.png) | ![expense](docs/expense.png) |
```

## 🛠️ Tech stack

| Layer | Choice |
|---|---|
| UI | Vanilla HTML / CSS / JS — no build step, no framework |
| Data | [Firebase Realtime Database](https://firebase.google.com/docs/database) |
| Auth | Custom mobile + password auth (SHA-256 hashed, salted) with DB-backed session tokens — **not** Firebase Auth |
| Offline | Service worker (`sw.js`) with app-shell caching |
| i18n | Lightweight custom `i18n.js` (Gujarati / English) |

## 📂 Project structure

```
.
├── index.html            # App shell — auth, trip picker, main app screens
├── style.css             # Design system + all component styles
├── app.js                # Members, expenses, settlement calculation
├── trips.js              # Trip create/join/share/delete logic
├── auth.js               # Register/login/session management
├── i18n.js                # Gujarati / English translations
├── firebase-config.js    # 🔑 Your Firebase project config goes here
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker (offline caching)
├── icon-192.png / icon-512.png
└── README.md
```

## 🗄️ Data model (Firebase Realtime Database)

```
/users/{mobile}                              -> { name, mobile, salt, passwordHash, createdAt }
/sessions/{token}                            -> { mobile, createdAt, expiresAt }
/userTrips/{mobile}/{tripId}                 -> true
/tripCodes/{code}                            -> tripId
/trips/{tripId}                              -> { name, startDate, createdAt, ownerMobile, code, note? }
/trips/{tripId}/participants/{mobile}        -> { name, joinedAt }
/trips/{tripId}/members/{memberId}           -> { name, count }
/trips/{tripId}/expenses/{expenseId}         -> { amount, paidBy, includedMembers[], date, note, paymentMethod }
/trips/{tripId}/notes/{noteId}               -> { title, content }
```

## 🚀 Getting started

### 1. Create a Firebase project
1. Go to the [Firebase Console](https://console.firebase.google.com) → **Add project**
2. **Build → Realtime Database → Create Database**
3. In the **Rules** tab, set (fine for testing/private groups — tighten before wider production use):
   ```json
   {
     "rules": {
@@ -95,36 +14,32 @@ Track who paid, who owes, and settle up — installable on any phone, works offl
   }
   ```

### 2. Add your config
1. **Project Settings ⚙️ → General → Your apps → Web app (`</>`)**
2. Copy the generated `firebaseConfig` object
3. Paste it into [`firebase-config.js`](./firebase-config.js), replacing the placeholder values

### 3. Run it locally
No build step needed — just serve the folder:
```bash
npx serve .
# or
python3 -m http.server 8080
```
Open `http://localhost:8080`.

### 4. Deploy
Any static host works — [Firebase Hosting](https://firebase.google.com/docs/hosting), [Netlify](https://netlify.com), or [Vercel](https://vercel.com). HTTPS is required for PWA install (localhost is fine for testing).

### 5. Install on mobile
Open the deployed URL in Chrome/Safari → **Add to Home Screen**. The app opens full-screen and works offline; syncing new data needs internet.

## 🔒 Security notes

- Passwords are never stored or transmitted in plain text — each is combined with a random per-user salt and hashed with SHA-256 before it reaches the database.
- Sessions are opaque tokens stored in `/sessions/{token}`, verified against the database on every load and expiring after 30 days (sliding expiry on use). Logging out deletes the token immediately.
- **Limitation:** there's no backend server or Firebase Authentication, so database rules can't cryptographically verify *who* is making a request. This setup is best-effort hardening for a private/trusted-group app — not a substitute for a real auth backend in a public production app.

## 🤝 Contributing

Issues and PRs welcome. Please keep the app dependency-free (vanilla HTML/CSS/JS) and test both Gujarati and English before submitting.

## 📄 License

MIT — see [LICENSE](./LICENSE).
