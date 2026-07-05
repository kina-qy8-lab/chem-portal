/* =========================================================
   Chem Portal — GAS バックエンド (Code.gs)

   ▼ 初回だけやること
   1. 下の INIT_ADMIN_PASS を自分のパスフレーズに書き換える
   2. エディタ上部で関数「setup」を選んで実行 (権限を承認)
   3. デプロイ → 新しいデプロイ → 種類: ウェブアプリ
        実行ユーザー: 自分 / アクセスできるユーザー: 全員
   4. 表示されたURL (末尾 /exec) を js/config.js の GAS_URL に貼る

   ▼ パスフレーズを変えたいとき
   INIT_ADMIN_PASS を書き換えて setup をもう一度実行
   (データは消えません)
   ========================================================= */

const INIT_ADMIN_PASS = "ここを自分のパスフレーズに変更してからsetupを実行";
const ROOT_FOLDER_NAME = "ChemPortal";
const TOKEN_DAYS = 90;           // 管理トークンの有効日数
const MAX_UPLOAD_MB = 25;        // アップロード上限

/* ---------------- 初期セットアップ ---------------- */
function setup() {
  const props = PropertiesService.getScriptProperties();

  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const root = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  const files = getOrCreateFolder_(root, "files");
  const htmls = getOrCreateFolder_(root, "html");

  let portalFile;
  const pf = root.getFilesByName("portal.json");
  if (pf.hasNext()) {
    portalFile = pf.next();
  } else {
    portalFile = root.createFile("portal.json", JSON.stringify(initialPortal_(), null, 1), MimeType.PLAIN_TEXT);
  }

  props.setProperty("FILES_FOLDER", files.getId());
  props.setProperty("HTML_FOLDER", htmls.getId());
  props.setProperty("PORTAL_FILE", portalFile.getId());
  if (!props.getProperty("SECRET")) {
    props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  }
  props.setProperty("ADMIN_PASS", INIT_ADMIN_PASS);

  Logger.log("セットアップ完了。次は「デプロイ → 新しいデプロイ → ウェブアプリ」です。");
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function initialPortal_() {
  return {
    version: 1,
    updatedAt: Date.now(),
    meta: { title: "Chem Portal", subtitle: "化学 授業ポータル" },
    subjects: [{
      id: "s_sample",
      name: "化学基礎",
      symbol: "基",
      color: "cu",
      units: [{
        id: "u_sample",
        name: "サンプル単元 (あとで削除できます)",
        lessons: [{
          id: "l_sample",
          title: "はじめての授業ページ",
          date: "",
          desc: "管理画面から自由に編集・削除できます。",
          live: { url: "" },
          review: { url: "" },
          materials: []
        }]
      }]
    }]
  };
}

/* ---------------- 共通 ---------------- */
function out_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function prop_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error("NOT_SETUP");
  return v;
}
function b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}

/* ---------------- トークン ---------------- */
function makeToken_() {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  const payload = "admin." + exp;
  const sig = b64url_(Utilities.computeHmacSha256Signature(payload, prop_("SECRET")));
  return payload + "." + sig;
}
function checkToken_(token) {
  if (!token) return false;
  const parts = String(token).split(".");
  if (parts.length !== 3 || parts[0] !== "admin") return false;
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) return false;
  const expect = b64url_(Utilities.computeHmacSha256Signature(parts[0] + "." + parts[1], prop_("SECRET")));
  return expect === parts[2];
}

/* ---------------- portal.json ---------------- */
function readPortal_() {
  const file = DriveApp.getFileById(prop_("PORTAL_FILE"));
  return JSON.parse(file.getBlob().getDataAsString("UTF-8"));
}
function writePortal_(portal) {
  DriveApp.getFileById(prop_("PORTAL_FILE")).setContent(JSON.stringify(portal));
  try { CacheService.getScriptCache().remove("portal"); } catch (e) {}
}

/* ---------------- GET ---------------- */
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || "";

    if (action === "ping") return out_({ ok: true, pong: Date.now() });

    if (action === "portal") {
      const cache = CacheService.getScriptCache();
      const hit = cache.get("portal");
      if (hit) return out_({ ok: true, data: JSON.parse(hit) });
      const portal = readPortal_();
      try { cache.put("portal", JSON.stringify(portal), 30); } catch (err) { /* 100KB超は非キャッシュ */ }
      return out_({ ok: true, data: portal });
    }

    if (action === "html") {
      const id = e.parameter.id;
      if (!id) return out_({ ok: false, error: "NO_ID" });
      const file = DriveApp.getFileById(id);
      if (!isInFolder_(file, prop_("HTML_FOLDER"))) return out_({ ok: false, error: "FORBIDDEN" });
      return out_({ ok: true, html: file.getBlob().getDataAsString("UTF-8") });
    }

    return out_({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function isInFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

/* ---------------- POST ---------------- */
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = req.action;

    /* --- ログイン (試行制限つき) --- */
    if (action === "login") {
      const cache = CacheService.getScriptCache();
      const fails = Number(cache.get("loginFails") || 0);
      if (fails >= 8) return out_({ ok: false, error: "LOCKED" });
      if (String(req.pass) === prop_("ADMIN_PASS")) {
        cache.remove("loginFails");
        return out_({ ok: true, token: makeToken_() });
      }
      cache.put("loginFails", String(fails + 1), 600);
      return out_({ ok: false, error: "BAD_PASS" });
    }

    /* --- 以降は要トークン --- */
    if (!checkToken_(req.token)) return out_({ ok: false, error: "AUTH" });

    if (action === "verify") return out_({ ok: true });

    if (action === "savePortal") {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        const cur = readPortal_();
        const curVer = cur.version || 0;
        if (Number(req.baseVersion) !== curVer) {
          return out_({ ok: false, error: "CONFLICT", serverVersion: curVer });
        }
        const next = req.portal;
        next.version = curVer + 1;
        next.updatedAt = Date.now();
        writePortal_(next);
        return out_({ ok: true, version: next.version });
      } finally {
        lock.releaseLock();
      }
    }

    if (action === "uploadFile") {
      const bytes = Utilities.base64Decode(req.b64);
      if (bytes.length > MAX_UPLOAD_MB * 1024 * 1024) return out_({ ok: false, error: "TOO_LARGE" });
      const mime = String(req.mime || "application/octet-stream");
      if (mime.indexOf("text/html") === 0) return out_({ ok: false, error: "USE_SAVE_HTML" });
      const blob = Utilities.newBlob(bytes, mime, String(req.name || "file"));
      const folder = DriveApp.getFolderById(prop_("FILES_FOLDER"));
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return out_({ ok: true, fileId: file.getId(), size: file.getSize(), mime: mime });
    }

    if (action === "saveHtml") {
      const html = String(req.html || "");
      if (!html) return out_({ ok: false, error: "EMPTY" });
      if (html.length > 3 * 1024 * 1024) return out_({ ok: false, error: "TOO_LARGE" });
      const folder = DriveApp.getFolderById(prop_("HTML_FOLDER"));
      if (req.fileId) {
        const file = DriveApp.getFileById(req.fileId);
        if (!isInFolder_(file, folder.getId())) return out_({ ok: false, error: "FORBIDDEN" });
        file.setContent(html);
        return out_({ ok: true, fileId: file.getId() });
      }
      const name = String(req.name || "app").replace(/[\\/:*?"<>|]/g, "_") + ".html";
      const file = folder.createFile(name, html, MimeType.HTML);
      // 共有はしない: 配信は doGet?action=html 経由のみ
      return out_({ ok: true, fileId: file.getId() });
    }

    if (action === "deleteFile") {
      const file = DriveApp.getFileById(String(req.fileId));
      const okParent = isInFolder_(file, prop_("FILES_FOLDER")) || isInFolder_(file, prop_("HTML_FOLDER"));
      if (!okParent) return out_({ ok: false, error: "FORBIDDEN" });
      file.setTrashed(true);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

/* ---------------- 補助 (エディタから手動実行) ---------------- */
/** ログイン試行制限を解除する */
function resetLoginLock() {
  CacheService.getScriptCache().remove("loginFails");
  Logger.log("ロックを解除しました");
}
/** portal.json の中身をログに表示する (バックアップ確認用) */
function dumpPortal() {
  Logger.log(JSON.stringify(readPortal_(), null, 2));
}
