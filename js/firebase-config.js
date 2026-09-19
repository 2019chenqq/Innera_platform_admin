// firebase-config.js
// 把這裡的設定換成「同一個 Firebase 專案」的 Web App 設定。
// Firebase Console → 專案設定 → 您的應用程式 → Web App → SDK 設定與配置。

window.INNERA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAuZv4YZA0VTKqSyYJ_mXnrYyF9Aal9GbY",
  authDomain: "moodsogood-9e45b.firebaseapp.com",
  projectId: "moodsogood-9e45b",
  storageBucket: "moodsogood-9e45b.firebasestorage.app",
  messagingSenderId: "510475967619",
  appId: "1:510475967619:web:c21c9d28fd763507c2cfb6"
};

// 目前測試用院所 ID，要跟 App 端 ClinicalShareService 寫入時一致。
window.INNERA_DEMO_CLINIC_ID = "innera-demo-clinic";

// P001 暫時代表你自己的真實資料。
// 注意：真正的 userId 不要硬編碼在公開 repo。
// MVP 測試時，登入同一個 Firebase 帳號後直接使用 auth.currentUser.uid。
window.INNERA_REAL_SLEEP_PATIENT_ID = "P000001";
