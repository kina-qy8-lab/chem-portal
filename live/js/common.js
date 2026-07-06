/* =========================================================
   live/js/common.js — ライブ授業 共通部品
   ・Firebase 初期化 + 匿名認証
   ・参加コード生成 / 化学向け数値の正規化と正誤判定
   ========================================================= */
const Live = (() => {

  let _db = null;
  let _uidPromise = null;

  function configured() {
    return typeof FIREBASE_CONFIG !== "undefined" &&
           FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf("ここに") !== 0 &&
           FIREBASE_CONFIG.databaseURL && FIREBASE_CONFIG.databaseURL.indexOf("http") === 0;
  }

  /** Firebase初期化 + 匿名ログイン。resolve時に {db, uid} を返す */
  function init() {
    if (_uidPromise) return _uidPromise;
    if (!configured()) return Promise.reject(new Error("FB_NOT_CONFIGURED"));
    firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.database();
    _uidPromise = firebase.auth().signInAnonymously()
      .then(cred => ({ db: _db, uid: cred.user.uid }))
      .catch(e => {
        _uidPromise = null;
        throw new Error(e && e.code === "auth/operation-not-allowed" ? "ANON_OFF" : "FB_AUTH_FAIL");
      });
    return _uidPromise;
  }

  /* ---------- 参加コード ---------- */
  // まぎらわしい文字(0,O,1,I,L)を除いた文字集合
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function randCode(n) {
    let s = "";
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    for (let i = 0; i < n; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
    return s;
  }
  function randId(prefix) {
    const a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return prefix + "_" + Array.from(a, x => x.toString(36)).join("").slice(0, 18);
  }

  /* ---------- 化学向け数値の正規化 ----------
     受け付ける例: 6.0×10^23 / 6.0*10^23 / 6.0x10^23 / 6.0e23 /
                   ６.０×１０^２３ / 0.05 / -1.5*10^-3 / 22,400 */
  function normalizeNumeric(input) {
    if (input == null) return NaN;
    let s = String(input).trim();
    // 全角 → 半角
    s = s.replace(/[０-９．－＋ｅＥ]/g, (c) =>
      "0123456789.-+eE"["０１２３４５６７８９．－＋ｅＥ".indexOf(c)]);
    s = s.replace(/[×✕✖ｘＸxX＊]/g, "*").replace(/[＾]/g, "^");
    s = s.replace(/[,、\s]/g, "");
    // a*10^b 形式
    let m = s.match(/^([+-]?\d*\.?\d+)\*10\^?\(?([+-]?\d+)\)?$/);
    if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
    // 10^b 単独
    m = s.match(/^10\^?\(?([+-]?\d+)\)?$/);
    if (m) return Math.pow(10, parseInt(m[1], 10));
    // a e b / 普通の数
    if (/^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/.test(s)) return parseFloat(s);
    return NaN;
  }

  /** 正誤判定: 相対誤差 tolPct% 以内なら正解 (正解が0のときは絶対誤差1e-9) */
  function numericMatch(answer, correct, tolPct) {
    const a = normalizeNumeric(answer);
    const c = normalizeNumeric(correct);
    if (isNaN(a) || isNaN(c)) return false;
    if (c === 0) return Math.abs(a) < 1e-9;
    return Math.abs(a - c) / Math.abs(c) <= (Number(tolPct) || 1) / 100;
  }

  /** 表示用: 1230000 → "1.23×10^6" のような読みやすい形 (そのままの文字列も可) */
  function prettyNumeric(raw) {
    const v = normalizeNumeric(raw);
    if (isNaN(v)) return String(raw);
    if (v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3)) {
      const exp = Math.floor(Math.log10(Math.abs(v)));
      const mant = v / Math.pow(10, exp);
      return (Math.round(mant * 1000) / 1000) + "×10^" + exp;
    }
    return String(v);
  }

  /* ---------- 問題タイプ ---------- */
  const ITEM_TYPES = {
    choice:  { label: "択一クイズ" },
    text:    { label: "自由記述" },
    scale:   { label: "5段階評価" },
    numeric: { label: "数値 (指数OK)" }
  };

  return { init, configured, randCode, randId,
           normalizeNumeric, numericMatch, prettyNumeric, ITEM_TYPES };
})();
