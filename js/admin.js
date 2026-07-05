/* =========================================================
   admin.js — 教員用管理画面 (admin.html)
   ・パスフレーズは初回のみ (トークンを端末に保存)
   ・変更は自動保存 (1.5秒デバウンス) + 手動保存ボタン
   ・科目/単元/授業の追加・改名・並べ替え・削除
   ・教材: ファイル / HTML貼り付け / HTMLファイル / リンク・スライド
   ========================================================= */
(() => {
  const $app = document.getElementById("app");
  const S = {
    portal: null,
    baseVersion: 0,
    dirty: false,
    saving: false,
    saveTimer: null
  };

  /* =============== 認証 =============== */
  function getToken() { return localStorage.getItem(CONFIG.TOKEN_KEY) || ""; }
  function setToken(t) { t ? localStorage.setItem(CONFIG.TOKEN_KEY, t) : localStorage.removeItem(CONFIG.TOKEN_KEY); }

  async function adminPost(action, payload) {
    const res = await Api.post(action, Object.assign({ token: getToken() }, payload || {}));
    if (!res.ok && res.error === "AUTH") {
      setToken("");
      UI.toast("ログインの有効期限が切れました", "err");
      showLogin();
      throw new Error("AUTH");
    }
    return res;
  }

  function showLogin() {
    document.getElementById("adminBar").style.display = "none";
    $app.innerHTML =
      '<div class="login-card"><h2>管理者ログイン</h2>' +
      '<div class="field"><label>パスフレーズ</label>' +
      '<input type="password" id="loginPass" autocomplete="current-password"></div>' +
      '<button class="btn btn-primary" id="loginBtn" style="width:100%">ログイン</button>' +
      '<p style="font-size:12px;color:var(--ink-soft);margin-top:14px">' +
      "この端末に90日間記憶されます。共有端末では使用後にログアウトしてください。</p></div>";
    const go = async () => {
      const pass = document.getElementById("loginPass").value;
      if (!pass) return;
      const btn = document.getElementById("loginBtn");
      btn.disabled = true; btn.textContent = "確認中…";
      try {
        const res = await Api.post("login", { pass: pass });
        if (res.ok) { setToken(res.token); boot(); }
        else { UI.toast("パスフレーズが違います", "err"); btn.disabled = false; btn.textContent = "ログイン"; }
      } catch (e) {
        UI.toast("接続できませんでした。config.js の GAS URL を確認してください", "err");
        btn.disabled = false; btn.textContent = "ログイン";
      }
    };
    document.getElementById("loginBtn").addEventListener("click", go);
    document.getElementById("loginPass").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    document.getElementById("loginPass").focus();
  }

  /* =============== 起動 =============== */
  async function boot() {
    if (!getToken()) return showLogin();
    $app.innerHTML = '<div class="loading"><div class="spin"></div>読み込み中…</div>';
    try {
      const v = await adminPost("verify", {});
      if (!v.ok) return; // AUTHはadminPost内で処理済み
      const res = await Api.get({ action: "portal", t: Date.now() });
      if (!res.ok) throw new Error(res.error);
      S.portal = res.data;
      S.baseVersion = res.data.version || 0;
      document.getElementById("adminBar").style.display = "";
      bindBar();
      render();
    } catch (e) {
      if (e.message === "AUTH") return;
      $app.innerHTML = '<div class="empty"><div class="big">⚠️</div><p>データを読み込めませんでした。' +
        "GASのデプロイとconfig.jsのURLを確認してください。</p></div>";
    }
  }

  /* =============== 保存 =============== */
  function markDirty() {
    S.dirty = true;
    updateSaveBtn();
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(save, 1500);
  }
  function updateSaveBtn() {
    const b = document.getElementById("btnSave");
    if (!b) return;
    if (S.saving) { b.textContent = "保存中…"; b.classList.add("save-on"); }
    else if (S.dirty) { b.textContent = "未保存の変更 → 保存"; b.classList.add("save-on"); }
    else { b.textContent = "保存済み ✓"; b.classList.remove("save-on"); }
  }

  async function save() {
    if (S.saving || !S.dirty) return;
    S.saving = true; updateSaveBtn();
    try {
      const res = await adminPost("savePortal", { baseVersion: S.baseVersion, portal: S.portal });
      if (res.ok) {
        S.baseVersion = res.version;
        S.portal.version = res.version;
        S.dirty = false;
        UI.toast("保存しました", "ok");
      } else if (res.error === "CONFLICT") {
        const reload = await UI.modal({
          title: "別の場所で更新されています",
          bodyHTML: "<p>他のタブや端末でデータが更新されました。<br>最新版を読み込み直しますか?<br>" +
            '<b style="color:var(--sr-deep)">この画面での未保存の変更は失われます。</b></p>',
          okText: "読み込み直す"
        });
        if (reload) { S.dirty = false; boot(); }
      } else {
        UI.toast("保存に失敗しました: " + (res.error || ""), "err");
      }
    } catch (e) {
      if (e.message !== "AUTH") UI.toast("保存に失敗しました (通信エラー)", "err");
    }
    S.saving = false; updateSaveBtn();
  }

  window.addEventListener("beforeunload", (e) => {
    if (S.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  /* =============== 上部バー =============== */
  function studentUrl() {
    if (CONFIG.STUDENT_URL) return CONFIG.STUDENT_URL;
    return location.origin + location.pathname.replace(/admin\.html.*$/, "index.html");
  }

  function bindBar() {
    document.getElementById("btnSave").onclick = () => { clearTimeout(S.saveTimer); save(); };
    document.getElementById("btnPreview").onclick = () => window.open(studentUrl(), "_blank");
    document.getElementById("btnShare").onclick = () => shareModal("生徒用ポータルのURL", studentUrl());
    document.getElementById("btnSettings").onclick = siteSettings;
    document.getElementById("btnLogout").onclick = async () => {
      if (S.dirty) { clearTimeout(S.saveTimer); await save(); }
      setToken(""); showLogin();
    };
    updateSaveBtn();
  }

  function shareModal(title, url) {
    UI.modal({
      title: title,
      bodyHTML:
        '<div class="field"><div class="url-copy"><input type="text" readonly id="shareUrl" value="' + UI.esc(url) + '">' +
        '<button class="btn btn-sub" id="copyBtn">コピー</button></div></div>' +
        '<div class="qr-box" id="qrBox"></div>' +
        '<p style="font-size:12px;color:var(--ink-soft);text-align:center">QRコードを長押し(右クリック)で画像として保存し、スライドやプリントに貼れます。</p>',
      okText: "閉じる", cancelText: null,
      onOpen: (root) => {
        root.querySelector("#copyBtn").addEventListener("click", () => {
          navigator.clipboard.writeText(url).then(
            () => UI.toast("コピーしました", "ok"),
            () => { root.querySelector("#shareUrl").select(); document.execCommand("copy"); UI.toast("コピーしました", "ok"); }
          );
        });
        try {
          const qr = qrcode(0, "M");
          qr.addData(url); qr.make();
          root.querySelector("#qrBox").innerHTML = '<img alt="QRコード" src="' + qr.createDataURL(5, 8) + '">';
        } catch (e) {
          root.querySelector("#qrBox").textContent = "QRの生成に失敗しました";
        }
      }
    });
  }

  function siteSettings() {
    const meta = S.portal.meta || (S.portal.meta = {});
    UI.modal({
      title: "サイト設定",
      bodyHTML:
        '<div class="field"><label>サイト名</label><input type="text" id="stTitle" value="' + UI.esc(meta.title || "") + '"></div>' +
        '<div class="field"><label>サブタイトル</label><input type="text" id="stSub" value="' + UI.esc(meta.subtitle || "") + '"></div>',
      okText: "決定",
      onOk: (root) => {
        meta.title = root.querySelector("#stTitle").value.trim();
        meta.subtitle = root.querySelector("#stSub").value.trim();
        markDirty(); render();
      }
    });
  }

  /* =============== ルーティング =============== */
  function route() {
    const p = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    return { sid: p[0] || null, uid: p[1] || null, lid: p[2] || null };
  }
  window.addEventListener("hashchange", () => { if (S.portal) render(); });

  function crumbs(items) {
    let h = '<nav class="crumbs">';
    items.forEach((it, i) => {
      if (i > 0) h += '<span class="arrow">→</span>';
      h += it.href ? '<a href="' + it.href + '">' + UI.esc(it.name) + "</a>"
                   : '<span class="here">' + UI.esc(it.name) + "</span>";
    });
    return h + "</nav>";
  }

  function move(arr, i, d) {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    markDirty(); render();
  }

  /* =============== 描画 =============== */
  function render() {
    const r = route();
    const s = r.sid && UI.findSubject(S.portal, r.sid);
    const u = r.uid && UI.findUnit(s, r.uid);
    const l = r.lid && UI.findLesson(u, r.lid);
    window.scrollTo(0, 0);
    if (l) return renderLessonEditor(s, u, l);
    if (u) return renderLessonList(s, u);
    if (s) return renderUnitList(s);
    renderSubjectList();
  }

  /* --- 科目一覧 --- */
  function renderSubjectList() {
    const subjects = S.portal.subjects || (S.portal.subjects = []);
    let h = '<div class="section-head"><h2 class="section-title">科目の管理</h2>' +
            '<span class="section-note">タイルをクリックで中身へ</span></div><div class="tile-grid">';
    subjects.forEach((s, i) => {
      const f = UI.flame(s.color);
      h += '<div class="el-tile admin-row" style="--tile-c:' + f.css + '" data-sid="' + UI.esc(s.id) + '" tabindex="0" role="link">' +
           '<span class="el-num">' + String(i + 1).padStart(2, "0") + "</span>" +
           '<span class="el-symbol">' + UI.esc(s.symbol || s.name.charAt(0)) + "</span>" +
           '<span class="el-name">' + UI.esc(s.name) + "</span>" +
           '<span class="el-meta">' + (s.units || []).length + "単元</span>" +
           '<span class="admin-tools" style="position:absolute;top:8px;right:8px">' +
           toolBtns(i, subjects.length) + "</span></div>";
    });
    h += "</div>" +
         '<button class="add-row" id="addSubject">＋ 科目を追加</button>';
    $app.innerHTML = h;

    $app.querySelectorAll(".el-tile").forEach((tile) => {
      const sid = tile.dataset.sid;
      const idx = subjects.findIndex(x => x.id === sid);
      bindTools(tile, subjects, idx,
        () => { location.hash = "#/" + sid; },
        () => editSubjectModal(subjects[idx]),
        () => deleteNode("科目「" + subjects[idx].name + "」", subjects, idx));
    });
    document.getElementById("addSubject").onclick = () => editSubjectModal(null);
  }

  function editSubjectModal(subject) {
    const isNew = !subject;
    const cur = subject || { name: "", symbol: "", color: "cu" };
    let sw = '<div class="swatches">';
    Object.keys(UI.FLAME).forEach((k) => {
      sw += '<label class="swatch' + (cur.color === k ? " on" : "") + '" data-k="' + k + '">' +
            '<input type="radio" name="flame" value="' + k + '"' + (cur.color === k ? " checked" : "") + ">" +
            '<span class="c" style="background:' + UI.FLAME[k].css + '"></span>' + UI.FLAME[k].label + "</label>";
    });
    sw += "</div>";
    UI.modal({
      title: isNew ? "科目を追加" : "科目を編集",
      bodyHTML:
        '<div class="field"><label>科目名</label><input type="text" id="sjName" value="' + UI.esc(cur.name) + '" placeholder="例: 化学基礎"></div>' +
        '<div class="field"><label>タイル記号 <span class="hint">1〜2文字 (元素記号風)</span></label>' +
        '<input type="text" id="sjSym" maxlength="2" value="' + UI.esc(cur.symbol) + '" placeholder="例: 基"></div>' +
        '<div class="field"><label>炎色 (テーマカラー)</label>' + sw + "</div>",
      okText: isNew ? "追加" : "決定",
      onOpen: (root) => {
        root.querySelectorAll(".swatch").forEach((el) => {
          el.addEventListener("click", () => {
            root.querySelectorAll(".swatch").forEach(x => x.classList.remove("on"));
            el.classList.add("on");
            el.querySelector("input").checked = true;
          });
        });
      },
      onOk: (root) => {
        const name = root.querySelector("#sjName").value.trim();
        if (!name) { UI.toast("科目名を入力してください", "err"); return false; }
        const symbol = root.querySelector("#sjSym").value.trim() || name.charAt(0);
        const color = (root.querySelector('input[name="flame"]:checked') || {}).value || "cu";
        if (isNew) S.portal.subjects.push({ id: UI.newId("s"), name, symbol, color, units: [] });
        else { subject.name = name; subject.symbol = symbol; subject.color = color; }
        markDirty(); render();
      }
    });
  }

  /* --- 単元一覧 --- */
  function renderUnitList(s) {
    const f = UI.flame(s.color);
    const units = s.units || (s.units = []);
    let h = crumbs([{ name: "科目一覧", href: "#/" }, { name: s.name }]);
    h += '<div class="section-head"><h2 class="section-title">' + UI.esc(s.name) + " の単元</h2></div><div class=\"row-list\">";
    units.forEach((u, i) => {
      h += '<div class="row-card admin-row" style="--row-c:' + f.css + ";--row-pale:" + f.pale +
           '" data-uid="' + UI.esc(u.id) + '" tabindex="0" role="link">' +
           '<span class="row-badge">' + (i + 1) + "</span>" +
           '<span class="row-main"><span class="row-title">' + UI.esc(u.name) + "</span>" +
           '<span class="row-sub"><span>' + (u.lessons || []).length + " 回の授業</span></span></span>" +
           '<span class="admin-tools">' + toolBtns(i, units.length) + "</span></div>";
    });
    h += "</div>" + '<button class="add-row" id="addUnit">＋ 単元を追加</button>';
    $app.innerHTML = h;

    $app.querySelectorAll(".row-card").forEach((row) => {
      const uid = row.dataset.uid;
      const idx = units.findIndex(x => x.id === uid);
      bindTools(row, units, idx,
        () => { location.hash = "#/" + s.id + "/" + uid; },
        () => renameModal("単元名", units[idx].name, (v) => { units[idx].name = v; }),
        () => deleteNode("単元「" + units[idx].name + "」", units, idx));
    });
    document.getElementById("addUnit").onclick = () =>
      renameModal("新しい単元の名前", "", (v) => { units.push({ id: UI.newId("u"), name: v, lessons: [] }); });
  }

  /* --- 授業一覧 --- */
  function renderLessonList(s, u) {
    const f = UI.flame(s.color);
    const lessons = u.lessons || (u.lessons = []);
    let h = crumbs([{ name: "科目一覧", href: "#/" }, { name: s.name, href: "#/" + s.id }, { name: u.name }]);
    h += '<div class="section-head"><h2 class="section-title">' + UI.esc(u.name) + " の授業</h2></div><div class=\"row-list\">";
    lessons.forEach((l, i) => {
      h += '<div class="row-card admin-row" style="--row-c:' + f.css + ";--row-pale:" + f.pale +
           '" data-lid="' + UI.esc(l.id) + '" tabindex="0" role="link">' +
           '<span class="row-badge">' + (i + 1) + "</span>" +
           '<span class="row-main"><span class="row-title">' + UI.esc(l.title) + "</span>" +
           '<span class="row-sub">' + (l.date ? "<span>" + UI.esc(l.date) + "</span>" : "") +
           "<span>教材 " + (l.materials || []).length + "件</span></span></span>" +
           '<span class="admin-tools">' + toolBtns(i, lessons.length) + "</span></div>";
    });
    h += "</div>" + '<button class="add-row" id="addLesson">＋ 授業を追加</button>';
    $app.innerHTML = h;

    $app.querySelectorAll(".row-card").forEach((row) => {
      const lid = row.dataset.lid;
      const idx = lessons.findIndex(x => x.id === lid);
      bindTools(row, lessons, idx,
        () => { location.hash = "#/" + s.id + "/" + u.id + "/" + lid; },
        null,
        () => deleteNode("授業「" + lessons[idx].title + "」", lessons, idx));
    });
    document.getElementById("addLesson").onclick = () => {
      const today = new Date().toISOString().slice(0, 10);
      const l = { id: UI.newId("l"), title: "新しい授業", date: today, desc: "",
                  live: { url: "" }, review: { url: "" }, materials: [] };
      lessons.push(l);
      markDirty();
      location.hash = "#/" + s.id + "/" + u.id + "/" + l.id;
    };
  }

  /* --- 共通ツール --- */
  function toolBtns(i, len) {
    return '<button class="icon-btn t-up" title="上へ"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
           '<button class="icon-btn t-down" title="下へ"' + (i === len - 1 ? " disabled" : "") + ">↓</button>" +
           '<button class="icon-btn t-edit" title="名前などを編集">✎</button>' +
           '<button class="icon-btn danger t-del" title="削除">✕</button>';
  }
  function bindTools(row, arr, idx, onOpen, onEdit, onDel) {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".admin-tools")) return;
      onOpen();
    });
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.target.closest(".admin-tools")) onOpen(); });
    const q = (c) => row.querySelector(c);
    q(".t-up").addEventListener("click", () => move(arr, idx, -1));
    q(".t-down").addEventListener("click", () => move(arr, idx, +1));
    const eBtn = q(".t-edit");
    if (onEdit) eBtn.addEventListener("click", onEdit); else eBtn.addEventListener("click", onOpen);
    q(".t-del").addEventListener("click", onDel);
  }

  function renameModal(label, current, apply) {
    UI.modal({
      title: label,
      bodyHTML: '<div class="field"><input type="text" id="rnVal" value="' + UI.esc(current) + '"></div>',
      okText: "決定",
      onOk: (root) => {
        const v = root.querySelector("#rnVal").value.trim();
        if (!v) { UI.toast("入力してください", "err"); return false; }
        apply(v); markDirty(); render();
      }
    });
  }

  async function deleteNode(label, arr, idx) {
    const ok = await UI.modal({
      title: "削除の確認",
      bodyHTML: "<p>" + UI.esc(label) + " を削除します。<br>中に含まれる授業・教材のリンクも一覧から消えます。よろしいですか?</p>" +
        '<p style="font-size:12px;color:var(--ink-soft)">※アップロード済みファイルの実体はDriveのゴミ箱には入りません。不要ならDriveから削除してください。</p>',
      okText: "削除する"
    });
    if (!ok) return;
    arr.splice(idx, 1);
    markDirty(); render();
  }

  /* =============== 授業エディタ =============== */
  function renderLessonEditor(s, u, l) {
    const f = UI.flame(s.color);
    l.live = l.live || { url: "" };
    l.review = l.review || { url: "" };
    l.materials = l.materials || [];

    let h = crumbs([
      { name: "科目一覧", href: "#/" },
      { name: s.name, href: "#/" + s.id },
      { name: u.name, href: "#/" + s.id + "/" + u.id },
      { name: l.title }
    ]);

    h += '<div class="panel" style="border-left:8px solid ' + f.css + '"><h3>授業の情報</h3>' +
         '<div class="editor-grid">' +
         '<div class="field full"><label>授業タイトル</label><input type="text" id="edTitle" value="' + UI.esc(l.title) + '"></div>' +
         '<div class="field"><label>日付</label><input type="date" id="edDate" value="' + UI.esc(l.date || "") + '"></div>' +
         '<div class="field"><label>&nbsp;</label><button class="btn btn-ghost" id="btnLessonShare" style="width:100%">' +
         "この授業の生徒用URL / QR</button></div>" +
         '<div class="field full"><label>説明 <span class="hint">生徒に表示されます</span></label>' +
         '<textarea id="edDesc">' + UI.esc(l.desc || "") + "</textarea></div>" +
         "</div></div>";

    h += '<div class="panel"><h3>授業ツールへのリンク</h3>' +
         '<div class="editor-grid">' +
         '<div class="field"><label>ライブ授業 (インタラクティブスライド) のURL <span class="hint">空欄なら生徒に非表示</span></label>' +
         '<input type="url" id="edLive" placeholder="https://…" value="' + UI.esc(l.live.url || "") + '"></div>' +
         '<div class="field"><label>復習問題のURL <span class="hint">空欄なら生徒に非表示</span></label>' +
         '<input type="url" id="edReview" placeholder="https://…" value="' + UI.esc(l.review.url || "") + '"></div>' +
         "</div></div>";

    h += '<div class="panel"><h3>教材</h3><div class="row-list" id="matList"></div>' +
         '<button class="add-row" id="addMat" style="margin-bottom:4px">＋ 教材を追加</button></div>';

    $app.innerHTML = h;

    // 入力バインド
    const bind = (id, apply) => {
      document.getElementById(id).addEventListener("input", (e) => { apply(e.target.value); markDirty(); });
    };
    bind("edTitle", (v) => { l.title = v; });
    bind("edDate", (v) => { l.date = v; });
    bind("edDesc", (v) => { l.desc = v; });
    bind("edLive", (v) => { l.live.url = v.trim(); });
    bind("edReview", (v) => { l.review.url = v.trim(); });

    document.getElementById("btnLessonShare").onclick = () =>
      shareModal("「" + l.title + "」の生徒用URL",
        studentUrl() + "#/" + s.id + "/" + u.id + "/" + l.id);

    document.getElementById("addMat").onclick = () => addMaterialModal(l);
    renderMatList(l);
  }

  function renderMatList(l) {
    const zone = document.getElementById("matList");
    if (!zone) return;
    const mats = l.materials;
    if (!mats.length) {
      zone.innerHTML = '<div class="empty" style="margin:0"><p>教材はまだありません。下のボタンから追加できます。</p></div>';
      return;
    }
    zone.innerHTML = "";
    mats.forEach((m, i) => {
      const t = UI.matType(m.type);
      const row = UI.el(
        '<div class="row-card admin-row" style="cursor:default">' +
        '<span class="mat-icon ' + t.cls + '" style="width:40px;height:40px">' + t.icon + "</span>" +
        '<span class="row-main"><span class="row-title">' + UI.esc(m.name) + "</span>" +
        '<span class="row-sub"><span>' + t.label + (m.size ? " · " + UI.fmtSize(m.size) : "") + "</span></span></span>" +
        '<span class="admin-tools">' +
        '<button class="icon-btn t-view" title="確認">👁</button>' +
        (m.type === "html" ? '<button class="icon-btn t-html" title="HTMLを編集">〈〉</button>' : "") +
        toolBtns(i, mats.length) + "</span></div>"
      );
      row.querySelector(".t-view").addEventListener("click", () => previewMat(m));
      row.querySelector(".t-up").addEventListener("click", () => { move(mats, i, -1); renderAfterMatMove(l); });
      row.querySelector(".t-down").addEventListener("click", () => { move(mats, i, +1); renderAfterMatMove(l); });
      row.querySelector(".t-edit").addEventListener("click", () =>
        renameModal("教材の表示名", m.name, (v) => { m.name = v; }));
      row.querySelector(".t-del").addEventListener("click", () => deleteMaterial(l, i));
      const hbtn = row.querySelector(".t-html");
      if (hbtn) hbtn.addEventListener("click", () => editHtmlModal(m));
      zone.appendChild(row);
    });
  }
  // move()内のrender()は授業エディタ全体を再描画するため教材リストも更新される
  function renderAfterMatMove() { /* renderで処理済み */ }

  function previewMat(m) {
    if (m.type === "pdf" || m.type === "file") {
      UI.openViewer({ title: m.name, kind: "iframe", src: UI.drivePreviewUrl(m.fileId), fullUrl: UI.driveViewUrl(m.fileId) });
    } else if (m.type === "image") {
      UI.openViewer({ title: m.name, kind: "image", src: UI.driveThumbUrl(m.fileId, 1600) });
    } else if (m.type === "slides") {
      UI.openViewer({ title: m.name, kind: "iframe", src: UI.slidesEmbedUrl(m.url), fullUrl: m.url });
    } else if (m.type === "link") {
      window.open(m.url, "_blank");
    } else if (m.type === "html") {
      Api.get({ action: "html", id: m.fileId }).then((res) => {
        if (res.ok) UI.openViewer({ title: m.name, kind: "srcdoc", src: res.html });
        else UI.toast("読み込めませんでした", "err");
      });
    }
  }

  async function deleteMaterial(l, idx) {
    const m = l.materials[idx];
    const hasFile = !!m.fileId;
    const ok = await UI.modal({
      title: "教材を削除",
      bodyHTML: "<p>「" + UI.esc(m.name) + "」を削除しますか?" +
        (hasFile ? "<br>Drive上のファイルもゴミ箱へ移動します。" : "") + "</p>",
      okText: "削除する"
    });
    if (!ok) return;
    l.materials.splice(idx, 1);
    markDirty(); render();
    if (hasFile) {
      try { await adminPost("deleteFile", { fileId: m.fileId }); }
      catch (e) { /* ゴミ箱移動の失敗は致命的でないため通知のみ */ UI.toast("Drive側の削除に失敗しました", "err"); }
    }
  }

  /* --- 教材追加モーダル (タブ式) --- */
  function addMaterialModal(l) {
    const body =
      '<div class="tabs">' +
      '<button class="tab on" data-t="file">ファイル</button>' +
      '<button class="tab" data-t="paste">HTML貼り付け</button>' +
      '<button class="tab" data-t="htmlfile">HTMLファイル</button>' +
      '<button class="tab" data-t="link">リンク / スライド</button>' +
      "</div>" +

      '<div class="tabpane" data-p="file">' +
      '<div class="field"><label>ファイルを選択 <span class="hint">PDF・画像など / 15MBまで推奨</span></label>' +
      '<input type="file" id="amFile"></div>' +
      '<div class="field"><label>表示名 <span class="hint">空欄ならファイル名</span></label>' +
      '<input type="text" id="amFileName" placeholder="例: 授業プリント No.12"></div></div>' +

      '<div class="tabpane" data-p="paste" style="display:none">' +
      '<div class="field"><label>表示名</label><input type="text" id="amPasteName" placeholder="例: 気液平衡シミュレーション"></div>' +
      '<div class="field"><label>HTMLコード <span class="hint">1ファイル完結のHTMLをそのまま貼り付け</span></label>' +
      '<textarea class="code" id="amPasteCode" placeholder="&lt;!DOCTYPE html&gt;…"></textarea></div></div>' +

      '<div class="tabpane" data-p="htmlfile" style="display:none">' +
      '<div class="field"><label>.htmlファイルを選択</label><input type="file" id="amHtmlFile" accept=".html,.htm,text/html"></div>' +
      '<div class="field"><label>表示名 <span class="hint">空欄ならファイル名</span></label>' +
      '<input type="text" id="amHtmlName"></div></div>' +

      '<div class="tabpane" data-p="link" style="display:none">' +
      '<div class="field"><label>表示名</label><input type="text" id="amLinkName" placeholder="例: 授業スライド"></div>' +
      '<div class="field"><label>URL <span class="hint">GoogleスライドのURLは自動でスライド扱いになります</span></label>' +
      '<input type="url" id="amLinkUrl" placeholder="https://…"></div></div>';

    UI.modal({
      title: "教材を追加",
      bodyHTML: body,
      okText: "追加する",
      onOpen: (root) => {
        root.querySelectorAll(".tab").forEach((tab) => {
          tab.addEventListener("click", () => {
            root.querySelectorAll(".tab").forEach(x => x.classList.remove("on"));
            tab.classList.add("on");
            root.querySelectorAll(".tabpane").forEach(p => {
              p.style.display = (p.dataset.p === tab.dataset.t) ? "" : "none";
            });
          });
        });
      },
      onOk: async (root) => {
        const activeTab = root.querySelector(".tab.on").dataset.t;
        const okBtn = root.querySelector(".m-ok");
        const busy = (on) => { okBtn.disabled = on; okBtn.textContent = on ? "アップロード中…" : "追加する"; };
        try {
          if (activeTab === "file") {
            const file = root.querySelector("#amFile").files[0];
            if (!file) { UI.toast("ファイルを選択してください", "err"); return false; }
            if (file.size > 20 * 1024 * 1024) { UI.toast("20MBを超えるファイルは扱えません", "err"); return false; }
            busy(true);
            const b64 = await Api.fileToB64(file);
            const res = await adminPost("uploadFile", { name: file.name, mime: file.type || "application/octet-stream", b64 });
            busy(false);
            if (!res.ok) { UI.toast("アップロード失敗: " + res.error, "err"); return false; }
            const type = file.type === "application/pdf" ? "pdf" :
                         (file.type || "").indexOf("image/") === 0 ? "image" : "file";
            l.materials.push({ id: UI.newId("m"), type,
              name: root.querySelector("#amFileName").value.trim() || file.name,
              fileId: res.fileId, mime: res.mime, size: res.size });

          } else if (activeTab === "paste" || activeTab === "htmlfile") {
            let name, html;
            if (activeTab === "paste") {
              name = root.querySelector("#amPasteName").value.trim();
              html = root.querySelector("#amPasteCode").value;
              if (!name) { UI.toast("表示名を入力してください", "err"); return false; }
            } else {
              const file = root.querySelector("#amHtmlFile").files[0];
              if (!file) { UI.toast("HTMLファイルを選択してください", "err"); return false; }
              html = await Api.fileToText(file);
              name = root.querySelector("#amHtmlName").value.trim() || file.name.replace(/\.html?$/i, "");
            }
            if (!html || !html.trim()) { UI.toast("HTMLが空です", "err"); return false; }
            busy(true);
            const res = await adminPost("saveHtml", { name, html });
            busy(false);
            if (!res.ok) { UI.toast("保存失敗: " + res.error, "err"); return false; }
            l.materials.push({ id: UI.newId("m"), type: "html", name, fileId: res.fileId, size: html.length });

          } else { // link
            const name = root.querySelector("#amLinkName").value.trim();
            const url = root.querySelector("#amLinkUrl").value.trim();
            if (!name || !url) { UI.toast("表示名とURLを入力してください", "err"); return false; }
            const type = /docs\.google\.com\/presentation\//.test(url) ? "slides" : "link";
            l.materials.push({ id: UI.newId("m"), type, name, url });
          }
          markDirty(); render();
          UI.toast("教材を追加しました", "ok");
        } catch (e) {
          busy(false);
          if (e.message !== "AUTH") UI.toast("エラーが発生しました (通信環境を確認)", "err");
          return false;
        }
      }
    });
  }

  /* --- HTML教材の再編集 --- */
  async function editHtmlModal(m) {
    UI.toast("読み込み中…");
    let cur = "";
    try {
      const res = await Api.get({ action: "html", id: m.fileId });
      if (!res.ok) throw new Error(res.error);
      cur = res.html;
    } catch (e) { UI.toast("読み込めませんでした", "err"); return; }
    UI.modal({
      title: "HTMLを編集: " + m.name,
      bodyHTML: '<div class="field"><textarea class="code" id="ehCode" style="min-height:320px"></textarea></div>',
      okText: "上書き保存",
      onOpen: (root) => { root.querySelector("#ehCode").value = cur; },
      onOk: async (root) => {
        const html = root.querySelector("#ehCode").value;
        const okBtn = root.querySelector(".m-ok");
        okBtn.disabled = true; okBtn.textContent = "保存中…";
        try {
          const res = await adminPost("saveHtml", { name: m.name, html, fileId: m.fileId });
          if (!res.ok) throw new Error(res.error);
          m.size = html.length;
          markDirty(); render();
          UI.toast("HTMLを更新しました", "ok");
        } catch (e) {
          okBtn.disabled = false; okBtn.textContent = "上書き保存";
          UI.toast("保存に失敗しました", "err");
          return false;
        }
      }
    });
  }

  boot();
})();
