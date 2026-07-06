/* =========================================================
   config.js — 環境設定 (デプロイ時にここだけ書き換える)
   ========================================================= */
const CONFIG = {
  // GASウェブアプリのURL (デプロイ後に貼り付け。末尾は /exec)
  GAS_URL: "ここにGASのウェブアプリURLを貼る",

  // portal.json が読めない時のフォールバック表示名
  SITE_TITLE: "Chem Portal",
  SITE_SUBTITLE: "化学 授業ポータル",

  // 生徒用URL (空なら admin.html → index.html の置換で自動生成)
  STUDENT_URL: "",

  // 埋め込みHTMLアプリに localStorage 等を許可するか
  // (false推奨: アプリはポータルと隔離される。trueにするとアプリ内保存が
  //  使えるが、貼り付けたHTMLがポータル側のデータに触れられるようになる)
  ALLOW_APP_STORAGE: false,

  // ポータルデータのキャッシュキー
  CACHE_KEY: "cp_portal_cache_v1",
  TOKEN_KEY: "cp_admin_token_v1"
};
