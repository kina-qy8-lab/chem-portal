/* =========================================================
   portal.js — 生徒用ポータル (index.html)
   ・ログイン不要 (閲覧のみ。個人情報は一切扱わない)
   ・localStorage キャッシュを即描画 → 裏で最新版を取得
   ・#/科目ID/単元ID/授業ID のハッシュルーティング
   ========================================================= */
(() => {
  const $app = document.getElementById("app");
  let portal = null;

  /* ---------- 起動 ---------- */
  async function boot() {
    // 1. キャッシュがあれば即描画 (体感速度優先)
    try {
      const cached = JSON.parse(localStorage.getItem(CONFIG.CACHE_KEY) || "null");
      if (cached && cached.subjects) { portal = cached; applyMeta(); render(); }
    } catch (e) { /* キャッシュ破損は無視 */ }

    if (!portal) {
      $app.innerHTML = '<div class="loading"><div class="spin"></div>読み込み中…</div>';
    }

    // 2. 最新データを取得
    try {
      const res = await Api.get({ action: "portal", t: Date.now() });
      if (res && res.ok && res.data) {
        const fresh = res.data;
        if (!portal || fresh.version !== portal.version) {
          portal = fresh;
          localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(fresh));
          applyMeta(); render();
        }
      }
    } catch (e) {
      if (!portal) {
        const msg = (e && e.message === "NOT_CONFIGURED")
          ? "config.js に GAS の URL がまだ設定されていません。"
          : "データを読み込めませんでした。通信環境を確認して再読み込みしてください。";
        $app.innerHTML = '<div class="empty"><div class="big">⚗️</div><p>' + UI.esc(msg) + "</p></div>";
      } else {
        UI.toast("最新データの取得に失敗しました (キャッシュを表示中)", "err");
      }
    }
  }

  function applyMeta() {
    const meta = portal.meta || {};
    document.title = meta.title || CONFIG.SITE_TITLE;
    const t = document.getElementById("siteTitle");
    const s = document.getElementById("siteSubtitle");
    if (t) t.textContent = meta.title || CONFIG.SITE_TITLE;
    if (s) s.textContent = meta.subtitle || CONFIG.SITE_SUBTITLE;
  }

  /* ---------- ルーティング ---------- */
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    return { sid: parts[0] || null, uid: parts[1] || null, lid: parts[2] || null };
  }
  window.addEventListener("hashchange", () => { if (portal) render(); });

  /* ---------- 描画 ---------- */
  function render() {
    const r = route();
    const s = r.sid && UI.findSubject(portal, r.sid);
    const u = r.uid && UI.findUnit(s, r.uid);
    const l = r.lid && UI.findLesson(u, r.lid);
    window.scrollTo(0, 0);
    if (l) return renderLesson(s, u, l);
    if (u) return renderUnit(s, u);
    if (s) return renderSubject(s);
    renderHome();
  }

  function crumbs(items) {
    // 反応式風パンくず: ホーム → 科目 → 単元 → 授業
    let h = '<nav class="crumbs" aria-label="現在地">';
    items.forEach((it, i) => {
      if (i > 0) h += '<span class="arrow">→</span>';
      h += it.href
        ? '<a href="' + it.href + '">' + UI.esc(it.name) + "</a>"
        : '<span class="here">' + UI.esc(it.name) + "</span>";
    });
    return h + "</nav>";
  }

  /* --- トップ: 科目タイル --- */
  function renderHome() {
    const subjects = portal.subjects || [];
    let h = '<div class="section-head"><h2 class="section-title">科目をえらぶ</h2>' +
            '<span class="section-note">タイルをタップ</span></div>';
    if (!subjects.length) {
      h += '<div class="empty"><div class="big">🧪</div><p>まだ科目が登録されていません。</p></div>';
    } else {
      h += '<div class="tile-grid">';
      subjects.forEach((s, i) => {
        const f = UI.flame(s.color);
        const nLessons = (s.units || []).reduce((a, u) => a + (u.lessons || []).length, 0);
        h += '<a class="el-tile" style="--tile-c:' + f.css + '" href="#/' + UI.esc(s.id) + '">' +
             '<span class="el-num">' + String(i + 1).padStart(2, "0") + "</span>" +
             '<span class="el-symbol">' + UI.esc(s.symbol || s.name.charAt(0)) + "</span>" +
             '<span class="el-name">' + UI.esc(s.name) + "</span>" +
             '<span class="el-meta">' + (s.units || []).length + "単元 / " + nLessons + "回</span></a>";
      });
      h += "</div>";
    }
    $app.innerHTML = h;
  }

  /* --- 科目: 単元一覧 --- */
  function renderSubject(s) {
    const f = UI.flame(s.color);
    let h = crumbs([{ name: "ホーム", href: "#/" }, { name: s.name }]);
    h += '<div class="section-head"><h2 class="section-title">' + UI.esc(s.name) + " の単元</h2></div>";
    const units = s.units || [];
    if (!units.length) {
      h += '<div class="empty"><div class="big">📚</div><p>まだ単元が登録されていません。</p></div>';
    } else {
      h += '<div class="row-list">';
      units.forEach((u, i) => {
        h += '<a class="row-card" style="--row-c:' + f.css + ";--row-pale:" + f.pale + '" href="#/' +
             UI.esc(s.id) + "/" + UI.esc(u.id) + '">' +
             '<span class="row-badge">' + (i + 1) + "</span>" +
             '<span class="row-main"><span class="row-title">' + UI.esc(u.name) + "</span>" +
             '<span class="row-sub"><span>' + (u.lessons || []).length + " 回の授業</span></span></span>" +
             '<span class="row-arrow">›</span></a>';
      });
      h += "</div>";
    }
    $app.innerHTML = h;
  }

  /* --- 単元: 授業一覧 --- */
  function renderUnit(s, u) {
    const f = UI.flame(s.color);
    let h = crumbs([{ name: "ホーム", href: "#/" }, { name: s.name, href: "#/" + s.id }, { name: u.name }]);
    h += '<div class="section-head"><h2 class="section-title">' + UI.esc(u.name) + "</h2></div>";
    const lessons = u.lessons || [];
    if (!lessons.length) {
      h += '<div class="empty"><div class="big">🗓️</div><p>まだ授業が登録されていません。</p></div>';
    } else {
      h += '<div class="row-list">';
      lessons.forEach((l, i) => {
        const nMat = (l.materials || []).length;
        const live = l.live && l.live.url;
        h += '<a class="row-card" style="--row-c:' + f.css + ";--row-pale:" + f.pale + '" href="#/' +
             UI.esc(s.id) + "/" + UI.esc(u.id) + "/" + UI.esc(l.id) + '">' +
             '<span class="row-badge">' + (i + 1) + "</span>" +
             '<span class="row-main"><span class="row-title">' + UI.esc(l.title) +
             (live ? ' <span style="color:var(--k);font-size:12px;font-weight:800">● LIVE</span>' : "") + "</span>" +
             '<span class="row-sub">' +
             (l.date ? "<span>" + UI.esc(l.date) + "</span>" : "") +
             "<span>教材 " + nMat + "件</span></span></span>" +
             '<span class="row-arrow">›</span></a>';
      });
      h += "</div>";
    }
    $app.innerHTML = h;
  }

  /* --- 授業ページ --- */
  function renderLesson(s, u, l) {
    const f = UI.flame(s.color);
    let h = crumbs([
      { name: "ホーム", href: "#/" },
      { name: s.name, href: "#/" + s.id },
      { name: u.name, href: "#/" + s.id + "/" + u.id },
      { name: l.title }
    ]);
    h += '<div class="lesson-head" style="--lesson-c:' + f.css + '">' +
         (l.date ? '<div class="lesson-date">' + UI.esc(l.date) + "</div>" : "") +
         '<h2 class="lesson-title">' + UI.esc(l.title) + "</h2>" +
         (l.desc ? '<div class="lesson-desc">' + UI.esc(l.desc) + "</div>" : "") +
         "</div>";

    // ライブ授業・復習問題への導線
    const live = l.live && l.live.url;
    const review = l.review && l.review.url;
    if (live || review) {
      h += '<div class="action-row">';
      if (live) h += '<a class="btn btn-live" target="_blank" rel="noopener" href="' + UI.esc(l.live.url) +
                     '"><span class="dot"></span>ライブ授業に参加</a>';
      if (review) h += '<a class="btn btn-review" target="_blank" rel="noopener" href="' + UI.esc(l.review.url) +
                       '">' + "復習問題にちょうせん</a>";
      h += "</div>";
    }

    // 教材
    h += '<div class="section-head"><h2 class="section-title">きょうの教材</h2></div>';
    const mats = l.materials || [];
    if (!mats.length) {
      h += '<div class="empty"><div class="big">🧫</div><p>この授業の教材はまだありません。</p></div>';
    } else {
      h += '<div class="mat-grid">';
      mats.forEach((m) => {
        const t = UI.matType(m.type);
        h += '<div class="mat-card">' +
             '<div class="mat-top"><span class="mat-icon ' + t.cls + '">' + t.icon + "</span>" +
             '<div><div class="mat-name">' + UI.esc(m.name) + "</div>" +
             '<div class="mat-kind">' + t.label + (m.size ? " · " + UI.fmtSize(m.size) : "") + "</div></div></div>" +
             '<div class="mat-actions" data-mid="' + UI.esc(m.id) + '">' + matButtons(m) + "</div></div>";
      });
      h += "</div>";
    }
    $app.innerHTML = h;

    // 教材ボタンにイベントを付与
    $app.querySelectorAll(".mat-actions").forEach((zone) => {
      const m = mats.find(x => x.id === zone.dataset.mid);
      zone.querySelectorAll("[data-act]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          if (btn.tagName === "BUTTON") e.preventDefault();
          matAction(btn.dataset.act, m);
        });
      });
    });
  }

  function matButtons(m) {
    switch (m.type) {
      case "pdf":
        return '<button class="btn btn-sub" data-act="preview">ひらく</button>' +
               '<a class="btn btn-ghost" style="padding:8px 16px;font-size:13.5px" target="_blank" rel="noopener" href="' +
               UI.esc(UI.driveViewUrl(m.fileId)) + '">別タブ</a>';
      case "image":
        return '<button class="btn btn-sub" data-act="image">みる</button>';
      case "slides":
        return '<button class="btn btn-sub" data-act="slides">ひらく</button>';
      case "html":
        return '<button class="btn btn-sub" data-act="app">▶ 起動する</button>' +
               '<a class="btn btn-ghost" style="padding:8px 16px;font-size:13.5px" target="_blank" rel="noopener" href="viewer.html?id=' +
               encodeURIComponent(m.fileId) + "&title=" + encodeURIComponent(m.name) + '">全画面</a>';
      case "link":
        return '<a class="btn btn-sub" target="_blank" rel="noopener" href="' + UI.esc(m.url) + '">ひらく</a>';
      default:
        return '<a class="btn btn-sub" target="_blank" rel="noopener" href="' +
               UI.esc(m.fileId ? UI.driveViewUrl(m.fileId) : m.url || "#") + '">ひらく</a>';
    }
  }

  async function matAction(act, m) {
    if (!m) return;
    if (act === "preview") {
      UI.openViewer({ title: m.name, kind: "iframe", src: UI.drivePreviewUrl(m.fileId), fullUrl: UI.driveViewUrl(m.fileId) });
    } else if (act === "image") {
      UI.openViewer({ title: m.name, kind: "image", src: UI.driveThumbUrl(m.fileId, 1600), fullUrl: UI.driveViewUrl(m.fileId) });
    } else if (act === "slides") {
      UI.openViewer({ title: m.name, kind: "iframe", src: UI.slidesEmbedUrl(m.url), fullUrl: m.url });
    } else if (act === "app") {
      UI.toast("アプリを準備中…");
      try {
        const res = await Api.get({ action: "html", id: m.fileId });
        if (!res.ok) throw new Error(res.error);
        UI.openViewer({
          title: m.name, kind: "srcdoc", src: res.html,
          fullUrl: "viewer.html?id=" + encodeURIComponent(m.fileId) + "&title=" + encodeURIComponent(m.name)
        });
      } catch (e) {
        UI.toast("アプリを読み込めませんでした", "err");
      }
    }
  }

  boot();
})();
