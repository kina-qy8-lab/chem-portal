/* =========================================================
   firebase-config.js — Firebase の接続設定
   (ライブ授業機能を使うときだけ必要。ポータルだけなら不要)

   Firebaseコンソール → プロジェクトの設定 → マイアプリ →
   「SDK の設定と構成」に表示される firebaseConfig を
   そのままコピーして下の中身を置き換える
   ========================================================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB1NkOz0xDNiHGqmaBwKM6KWxgW_N8ThTg",
  authDomain: "chem-portal-live.firebaseapp.com",
  databaseURL: "https://chem-portal-live-default-rtdb.asia-southeast1.firebasedatabase.app",   // ← これが無いプロジェクトはRealtime Database未作成
  projectId: "chem-portal-live",
  appId: "1:200049948707:web:ed3f004ba5338f0c0d5996"
};
