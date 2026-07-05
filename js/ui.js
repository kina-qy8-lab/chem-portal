/* =========================================================
   ui.js — 共通UI部品
   炎色パレット / 教材タイプ定義 / アイコン / モーダル / トースト /
   オーバーレイビューア / 各種ヘルパ
   ========================================================= */
const UI = (() => {

  /* ---------- 炎色反応パレット ---------- */
  const FLAME = {
    cu: { label: "Cu 青緑", css: "var(--cu)", pale: "var(--cu-pale)", hex: "#0fa3b1" },
    na: { label: "Na 黄",   css: "var(--na)", pale: "var(--na-pale)", hex: "#f5a623" },
    k:  { label: "K 紫",    css: "var(--k)",  pale: "var(--k-pale)",  hex: "#8b5cf6" },
    sr: { label: "Sr 紅",   css: "var(--sr)", pale: "var(--sr-pale)", hex: "#f0566b" },
    ba: { label: "Ba 黄緑", css: "var(--ba)", pale: "var(--ba-pale)", hex: "#4fae67" },
    li: { label: "Li 赤",   css: "var(--li)", pale: "var(--li-pale)", hex: "#e4405f" }
  };
  function flame(key) { return FLAME[key] || FLAME.cu; }

  /* ---------- アイコン (インラインSVG) ---------- */
  const I = {
    doc:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    slides:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v6.5L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V2"/><path d="M8 2h8M7.5 14h9"/></svg>',
    link:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    file:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    qr:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v7M14 21h4"/></svg>',
    play:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>'
  };

  /* ---------- 教材タイプ定義 ---------- */
  const MAT_TYPES = {
    pdf:    { label: "プリント / PDF", cls: "type-pdf",    icon: I.doc },
    image:  { label: "画像",          cls: "type-image",  icon: I.image },
    slides: { label: "スライド",      cls: "type-slides", icon: I.slides },
    html:   { label: "アプリ / 教材", cls: "type-html",   icon: I.flask },
    link:   { label: "リンク",        cls: "type-link",   icon: I.link },
    file:   { label: "ファイル",      cls: "type-file",   icon: I.file }
  };
  function matType(t) { return MAT_TYPES[t] || MAT_TYPES.file; }

  /* ---------- ヘルパ ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }
  function newId(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* Drive URL 系 */
  function drivePreviewUrl(fileId) { return "https://drive.google.com/file/d/" + fileId + "/preview"; }
  function driveViewUrl(fileId)    { return "https://drive.google.com/file/d/" + fileId + "/view"; }
  function driveThumbUrl(fileId, w){ return "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w" + (w || 1600); }
  /** GoogleスライドURL → 埋め込みURL */
  function slidesEmbedUrl(url) {
    const m = String(url).match(/presentation\/d\/([-\w]+)/);
    if (m) return "https://docs.google.com/presentation/d/" + m[1] + "/embed?start=false&loop=false";
    return url;
  }

  /* ---------- トースト ---------- */
  function toast(msg, kind) {
    let zone = document.querySelector(".toast-zone");
    if (!zone) { zone = el('<div class="toast-zone"></div>'); document.body.appendChild(zone); }
    const t = el('<div class="toast ' + (kind || "") + '">' + esc(msg) + "</div>");
    zone.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /* ---------- モーダル ----------
     modal({ title, bodyHTML, okText, cancelText, onOpen(root), onOk(root)->bool|Promise })
     onOk が false を返すと閉じない */
  function modal(opts) {
    return new Promise((resolve) => {
      const back = el(
        '<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">' +
        "<h3>" + esc(opts.title || "") + "</h3>" +
        '<div class="modal-body">' + (opts.bodyHTML || "") + "</div>" +
        '<div class="modal-btns">' +
        (opts.cancelText === null ? "" : '<button class="btn btn-ghost m-cancel">' + esc(opts.cancelText || "キャンセル") + "</button>") +
        '<button class="btn btn-primary m-ok">' + esc(opts.okText || "OK") + "</button>" +
        "</div></div></div>"
      );
      const close = (val) => { back.remove(); document.removeEventListener("keydown", onKey); resolve(val); };
      const onKey = (e) => { if (e.key === "Escape") close(null); };
      back.addEventListener("click", (e) => { if (e.target === back) close(null); });
      const cancelBtn = back.querySelector(".m-cancel");
      if (cancelBtn) cancelBtn.addEventListener("click", () => close(null));
      back.querySelector(".m-ok").addEventListener("click", async () => {
        if (opts.onOk) {
          const ok = await opts.onOk(back);
          if (ok === false) return;
          close(ok === undefined ? true : ok);
        } else close(true);
      });
      document.addEventListener("keydown", onKey);
      document.body.appendChild(back);
      if (opts.onOpen) opts.onOpen(back);
      const first = back.querySelector("input, textarea, select, button.m-ok");
      if (first) first.focus();
    });
  }

  /* ---------- オーバーレイビューア ----------
     openViewer({ title, kind: 'iframe'|'srcdoc'|'image', src, fullUrl }) */
  function openViewer(opts) {
    const ov = el(
      '<div class="overlay">' +
      '<div class="overlay-bar">' +
      '<div class="overlay-title">' + esc(opts.title || "") + "</div>" +
      '<div class="btns">' +
      (opts.fullUrl ? '<a class="btn btn-sub" target="_blank" rel="noopener" href="' + esc(opts.fullUrl) + '">別タブで開く</a>' : "") +
      '<button class="btn btn-danger ov-close">閉じる ✕</button>' +
      "</div></div>" +
      '<div class="overlay-frame-wrap"></div></div>'
    );
    const wrap = ov.querySelector(".overlay-frame-wrap");
    if (opts.kind === "image") {
      wrap.appendChild(el('<div class="overlay-img-wrap"><img alt="" src="' + esc(opts.src) + '"></div>'));
    } else {
      const f = document.createElement("iframe");
      if (opts.kind === "srcdoc") {
        f.setAttribute("sandbox",
          "allow-scripts allow-popups allow-modals allow-forms allow-pointer-lock allow-downloads" +
          (CONFIG.ALLOW_APP_STORAGE ? " allow-same-origin" : ""));
        f.srcdoc = opts.src;
      } else {
        f.setAttribute("allow", "fullscreen");
        f.src = opts.src;
      }
      wrap.appendChild(f);
    }
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    ov.querySelector(".ov-close").addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov);
  }

  /* ---------- ツリー探索ヘルパ ---------- */
  function findSubject(portal, sid) { return (portal.subjects || []).find(s => s.id === sid); }
  function findUnit(subject, uid)   { return subject && (subject.units || []).find(u => u.id === uid); }
  function findLesson(unit, lid)    { return unit && (unit.lessons || []).find(l => l.id === lid); }

  return {
    FLAME, flame, I, MAT_TYPES, matType,
    esc, el, fmtSize, newId,
    drivePreviewUrl, driveViewUrl, driveThumbUrl, slidesEmbedUrl,
    toast, modal, openViewer,
    findSubject, findUnit, findLesson
  };
})();
