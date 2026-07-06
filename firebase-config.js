// ==========================================================
// 👉 તમારો Firebase config અહીં નાખો (Firebase Console > Project Settings)
// Realtime Database બનાવીને URL પણ નાખવાનું ભૂલશો નહીં
// ==========================================================
const firebaseConfig = {
  apiKey: "AIzaSyC46msoz5V4dzEqDPgkSQI3zdC0fv8cGqU",
  authDomain: "hisab-18fa4.firebaseapp.com",
  databaseURL: "https://hisab-18fa4-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hisab-18fa4",
  storageBucket: "hisab-18fa4.firebasestorage.app",
  messagingSenderId: "366726778637",
  appId: "1:366726778637:web:091ce3a41bcda58cd9ea44"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();