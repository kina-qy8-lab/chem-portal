/* =========================================================
   api.js — GAS ウェブアプリとの通信ラッパ
   ・POST は Content-Type: text/plain で送る (GASのCORS制約回避)
   ・失敗時は指数バックオフで最大3回リトライ
   ========================================================= */
const Api = (() => {

  function checkConfigured() {
    if (!CONFIG.GAS_URL || CONFIG.GAS_URL.indexOf("http") !== 0) {
      throw new Error("NOT_CONFIGURED");
    }
  }

  async function fetchWithRetry(url, options, tries) {
    tries = tries || 3;
    let wait = 800;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error("HTTP_" + res.status);
        return await res.json();
      } catch (e) {
        if (i === tries - 1) throw e;
        await new Promise(r => setTimeout(r, wait + Math.random() * 400));
        wait *= 2;
      }
    }
  }

  /** GET系: action と パラメータを渡す */
  async function get(params) {
    checkConfigured();
    const qs = new URLSearchParams(params).toString();
    return fetchWithRetry(CONFIG.GAS_URL + "?" + qs, { method: "GET" });
  }

  /** POST系: action名とペイロード */
  async function post(action, payload) {
    checkConfigured();
    const body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    return fetchWithRetry(CONFIG.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body
    });
  }

  /** File/Blob → base64 (dataURLのヘッダを除去) */
  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1]);
      r.onerror = () => reject(new Error("READ_FAIL"));
      r.readAsDataURL(file);
    });
  }

  /** File → テキスト (HTMLファイル取込用) */
  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("READ_FAIL"));
      r.readAsText(file, "utf-8");
    });
  }

  return { get, post, fileToB64, fileToText };
})();
