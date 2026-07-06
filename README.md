# ખર્ચા હિસાબ - Setup Guide

## 1. Firebase Project બનાવો
1. https://console.firebase.google.com પર જાઓ
2. "Add project" કરીને નવો પ્રોજેક્ટ બનાવો
3. ડાબી બાજુ મેનુ માંથી **Build > Realtime Database** ખોલો > "Create Database" કરો
4. Rules ટેબમાં નીચે મુજબ rules નાખો (testing માટે - production માટે વધુ સિક્યોર rules વાપરો):
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```

## 2. Config કોપી કરો
1. Project Settings (⚙️ icon) > General ટેબ > "Your apps" > Web app (</>) ઉમેરો
2. મળતો `firebaseConfig` ઓબ્જેક્ટ કોપી કરો
3. `firebase-config.js` ફાઇલમાં `YOUR_...` વાળી બધી વેલ્યુ બદલી નાખો

## 3. Website Host કરો
- સૌથી સહેલું: [Firebase Hosting](https://firebase.google.com/docs/hosting), Netlify, અથવા Vercel પર બધી ફાઈલ upload કરો
- HTTPS જરૂરી છે PWA install થવા માટે (localhost પર testing પણ ચાલશે)

## 4. Mobile પર Install કરો
- Website ખોલો Chrome/Safari માં > "Add to Home Screen" પસંદ કરો
- App icon મળી જશે, offline પણ ખુલશે (data sync મટે internet જોઈએ)

## Files
- `index.html` - મુખ્ય પેજ (ટ્રિપ પિકર + મુખ્ય એપ)
- `style.css` - સફેદ થીમ, mobile-first ડિઝાઇન
- `trips.js` - ટ્રિપ ઉમેરવા/પસંદ કરવા/ડિલીટ કરવાનું logic
- `app.js` - Members, expenses, settlement calculation (પસંદ કરેલી ટ્રિપ સાથે જોડાયેલું)
- `i18n.js` - ગુજરાતી/English ભાષા બદલવાનું logic
- `firebase-config.js` - **તમારે તમારો Firebase config અહીં નાખવાનો છે**
- `manifest.json`, `sw.js` - PWA support

## Data structure (Firebase Realtime Database)
```
/trips/{tripId}
  name, startDate, createdAt
  /members/{memberId}   -> { name, count }
  /expenses/{expenseId} -> { amount, paidBy, includedMembers[], date, note }
```
