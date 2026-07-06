/* =========================================================
   live/js/teacher.js — 教員用ライブ授業 (teacher.html)
   ・問題デッキの作成/編集 (Driveに保存・端末に依存しない)
   ・セッション開始 → 参加コード+QR → リアルタイム集計 → 答え合わせ
   ・終了時に結果をDriveへ保存 + CSVダウンロード
   ========================================================= */
(() => {
  const $app = document.getElementById("app");
  const RESUME_KEY = "cp_live_resume_v1";
  const FLAMES = ["sr", "cu", "na", "k", "ba", "li"];
  const ABC = "ABCDEF";

  const T = {
    uid: null, db: null,
    decks: [],
    deck: null, deckDirty: false,   // 編集中デッキ
    run: null                        // {sid, code, deck, state, presenceN, answers, subs, hiddenText:Set}
  };

  /* ================= 管理者認証 (ポータルと共通トークン) ================= */
  function getToken() { return localStorage.getItem(CONFIG.TOKEN_KEY) || ""; }
  function setToken(t) { t ? localStorage.setItem(CONFIG.TOKEN_KEY, t) : localStorage.removeItem(CONFIG.TOKEN_KEY); }

  async function adminPost(action, payload) {
    const res = await Api.post(action, Object.assign({ token: getToken() }, payload || {}));
    if (!res.ok && res.error === "AUTH") { setToken(""); showLogin(); throw new Error("AUTH"); }
    return res;
  }

  function showLogin() {
    $app.innerHTML =
      '<div class="login-card"><h2>管理者ログイン</h2>' +
      '<div class="field"><label>パスフレーズ</label><input type="password" id="lgPass"></div>' +
      '<button class="btn btn-primary" id="lgGo" style="width:100%">ログイン</button></div>';
    const go = async () => {
      const pass = document.getElementById("lgPass").value;
      if (!pass) return;
      try {
        const res = await Api.post("login", { pass });
        if (res.ok) { setToken(res.token); boot(); }
        else UI.toast("パスフレーズが違います", "err");
      } catch (e) { UI.toast("接続できませんでした", "err"); }
    };
    document.getElementById("lgGo").addEventListener("click", go);
    document.getElementById("lgPass").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    document.getElementById("lgPass").focus();
  }

  /* ================= 起動 ================= */
  async function boot() {
    if (!getToken()) return showLogin();
    $app.innerHTML = '<div class="loading"><div class="spin"></div>準備中…</div>';

    if (!Live.configured()) {
      $app.innerHTML =
        '<div class="empty"><div class="big">🔧</div><p><b>Firebaseの設定がまだです。</b><br>' +
        "「ライブ授業セットアップ手順書」の手順で js/firebase-config.js に設定を貼り付けてください。<br>" +
        "(ポータル本体はFirebaseなしでも動きます)</p></div>";
      return;
    }
    try {
      const v = await adminPost("verify", {});
      if (!v.ok) return;
      const fb = await Live.init();
      T.db = fb.db; T.uid = fb.uid;
    } catch (e) {
      if (e.message === "AUTH") return;
      const msg = e.message === "ANON_OFF"
        ? "Firebaseコンソールで「匿名ログイン」を有効にしてください (手順書 STEP 2)。"
        : "Firebaseに接続できませんでした。firebase-config.js の内容を確認してください。";
      $app.innerHTML = '<div class="empty"><div class="big">📡</div><p>' + UI.esc(msg) + "</p></div>";
      return;
    }
    renderHome();
  }

  /* ================= ホーム: デッキ一覧 ================= */
  async function renderHome() {
    T.deck = null; T.run = null;
    $app.innerHTML = '<div class="loading"><div class="spin"></div>デッキを読み込み中…</div>';
    try {
      const res = await adminPost("listDecks", {});
      T.decks = res.ok ? (res.decks || []) : [];
    } catch (e) { if (e.message === "AUTH") return; T.decks = []; }

    let h = '<div class="section-head"><h2 class="section-title">⚡ ライブ授業</h2>' +
            '<a class="btn btn-ghost" href="../admin.html" style="padding:8px 16px;font-size:13.5px">← ポータル管理へ</a></div>';

    // 進行中セッションの再開
    const resume = JSON.parse(localStorage.getItem(RESUME_KEY) || "null");
    if (resume && resume.sid) {
      h += '<div class="panel" style="border-left:8px solid var(--k)"><h3>進行中のライブがあります</h3>' +
           '<p style="margin:0 0 10px;font-size:14px">コード <b class="pill hot">' + UI.esc(resume.code) + "</b> / " +
           UI.esc(resume.title || "") + "</p>" +
           '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
           '<button class="btn btn-primary" id="resumeGo">再開する</button>' +
           '<button class="btn btn-danger" id="resumeDrop">破棄する</button></div></div>';
    }

    if (!T.decks.length) {
      h += '<div class="empty"><div class="big">🃏</div><p>まだ問題デッキがありません。<br>「＋新しいデッキ」から作成しましょう。</p></div>';
    } else {
      h += '<div class="row-list">';
      T.decks.forEach((d) => {
        h += '<div class="row-card admin-row" style="cursor:default" data-id="' + UI.esc(d.id) + '">' +
             '<span class="row-badge" style="background:var(--k-pale);color:var(--k-deep)">' + (d.count || 0) + "問</span>" +
             '<span class="row-main"><span class="row-title">' + UI.esc(d.title) + "</span>" +
             '<span class="row-sub"><span>' + (d.updatedAt ? new Date(d.updatedAt).toLocaleString("ja-JP") : "") + "</span></span></span>" +
             '<span class="admin-tools">' +
             '<button class="btn btn-live d-start" style="padding:8px 18px;font-size:14px"><span class="dot"></span>開始</button>' +
             '<button class="icon-btn d-edit" title="編集">✎</button>' +
             '<button class="icon-btn danger d-del" title="削除">✕</button></span></div>';
      });
      h += "</div>";
    }
    h += '<button class="add-row" id="addDeck">＋ 新しいデッキ</button>';
    $app.innerHTML = h;

    if (resume && resume.sid) {
      document.getElementById("resumeGo").onclick = () => resumeSession(resume);
      document.getElementById("resumeDrop").onclick = () => { localStorage.removeItem(RESUME_KEY); renderHome(); };
    }
    document.getElementById("addDeck").onclick = () => {
      T.deck = { id: UI.newId("dk"), title: "新しいデッキ", items: [] };
      T.deckDirty = true;
      renderEditor();
    };
    $app.querySelectorAll(".row-card[data-id]").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".d-start").addEventListener("click", () => startSession(id));
      row.querySelector(".d-edit").addEventListener("click", () => openDeck(id));
      row.querySelector(".d-del").addEventListener("click", async () => {
        const d = T.decks.find(x => x.id === id);
        const ok = await UI.modal({ title: "デッキを削除", bodyHTML: "<p>「" + UI.esc(d.title) + "」を削除しますか?</p>", okText: "削除する" });
        if (!ok) return;
        try { await adminPost("deleteDeck", { id }); UI.toast("削除しました", "ok"); renderHome(); }
        catch (e) { if (e.message !== "AUTH") UI.toast("削除に失敗しました", "err"); }
      });
    });
  }

  async function openDeck(id) {
    $app.innerHTML = '<div class="loading"><div class="spin"></div>読み込み中…</div>';
    try {
      const res = await adminPost("getDeck", { id });
      if (!res.ok) throw new Error(res.error);
      T.deck = res.deck; T.deckDirty = false;
      renderEditor();
    } catch (e) { if (e.message !== "AUTH") { UI.toast("読み込めませんでした", "err"); renderHome(); } }
  }

  /* ================= デッキ編集 ================= */
  function renderEditor() {
    const d = T.deck;
    let h = '<div class="section-head"><h2 class="section-title">デッキ編集</h2>' +
            '<div style="display:flex;gap:8px">' +
            '<button class="btn btn-ghost" id="edBack" style="padding:8px 16px;font-size:13.5px">← 一覧へ</button>' +
            '<button class="btn btn-primary" id="edSave" style="padding:8px 18px;font-size:13.5px">' +
            (T.deckDirty ? "保存する" : "保存済み ✓") + "</button></div></div>";

    h += '<div class="panel"><div class="field"><label>デッキ名</label>' +
         '<input type="text" id="edTitle" value="' + UI.esc(d.title) + '"></div></div>';

    d.items.forEach((it, i) => {
      h += '<div class="item-card"><div class="head">' +
           '<span class="row-badge" style="width:38px;height:38px;font-size:15px">Q' + (i + 1) + "</span>" +
           '<span class="type-tag">' + Live.ITEM_TYPES[it.type].label + "</span>" +
           '<span style="flex:1;font-weight:700;font-size:14.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
           UI.esc(it.q) + "</span>" +
           '<span class="admin-tools" data-i="' + i + '">' +
           '<button class="icon-btn i-up"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
           '<button class="icon-btn i-down"' + (i === d.items.length - 1 ? " disabled" : "") + ">↓</button>" +
           '<button class="icon-btn i-edit">✎</button>' +
           '<button class="icon-btn danger i-del">✕</button></span></div>' +
           itemSummary(it) + "</div>";
    });
    h += '<button class="add-row" id="addItem">＋ 問題を追加</button>';
    $app.innerHTML = h;

    document.getElementById("edTitle").addEventListener("input", (e) => { d.title = e.target.value; dirty(); });
    document.getElementById("edBack").onclick = async () => {
      if (T.deckDirty) {
        const ok = await UI.modal({ title: "保存していない変更があります", bodyHTML: "<p>保存して戻りますか?</p>", okText: "保存して戻る" });
        if (ok) await saveDeck();
      }
      renderHome();
    };
    document.getElementById("edSave").onclick = saveDeck;
    document.getElementById("addItem").onclick = () => itemModal(null);

    $app.querySelectorAll(".admin-tools[data-i]").forEach((z) => {
      const i = Number(z.dataset.i);
      z.querySelector(".i-up").addEventListener("click", () => { swap(d.items, i, -1); });
      z.querySelector(".i-down").addEventListener("click", () => { swap(d.items, i, +1); });
      z.querySelector(".i-edit").addEventListener("click", () => itemModal(i));
      z.querySelector(".i-del").addEventListener("click", () => { d.items.splice(i, 1); dirty(); renderEditor(); });
    });
  }

  function swap(arr, i, dlt) {
    const j = i + dlt;
    if (j < 0 || j >= arr.length) return;
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    dirty(); renderEditor();
  }
  function dirty() {
    T.deckDirty = true;
    const b = document.getElementById("edSave");
    if (b) b.textContent = "保存する";
  }
  async function saveDeck() {
    if (!T.deck.title.trim()) return UI.toast("デッキ名を入力してください", "err");
    T.deck.updatedAt = Date.now();
    try {
      const res = await adminPost("saveDeck", { deck: T.deck });
      if (!res.ok) throw new Error(res.error);
      T.deckDirty = false;
      const b = document.getElementById("edSave");
      if (b) b.textContent = "保存済み ✓";
      UI.toast("デッキを保存しました", "ok");
    } catch (e) { if (e.message !== "AUTH") UI.toast("保存に失敗しました", "err"); }
  }

  function itemSummary(it) {
    if (it.type === "choice") {
      return '<div style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">' +
             (it.options || []).map((o, i) => ABC[i] + ". " + UI.esc(o) +
               (it.correct === i ? " ✓" : "")).join(" ／ ") + "</div>";
    }
    if (it.type === "numeric") {
      return '<div style="font-size:12.5px;color:var(--ink-soft);margin-top:6px;font-family:var(--font-mono)">正解: ' +
             UI.esc(it.correct || "(なし)") + (it.unit ? " " + UI.esc(it.unit) : "") +
             " / 許容誤差 ±" + (it.tol || 1) + "%</div>";
    }
    if (it.type === "scale") {
      return '<div style="font-size:12.5px;color:var(--ink-soft);margin-top:6px">1: ' +
             UI.esc(it.left || "そう思わない") + " 〜 5: " + UI.esc(it.right || "そう思う") + "</div>";
    }
    return "";
  }

  /* --- 問題の追加/編集モーダル --- */
  function itemModal(index) {
    const d = T.deck;
    const isNew = index == null;
    const it = isNew
      ? { type: "choice", q: "", options: ["", ""], correct: null, left: "", right: "", unit: "", tol: 1 }
      : JSON.parse(JSON.stringify(d.items[index]));

    let typeSel = '<select id="imType">';
    Object.keys(Live.ITEM_TYPES).forEach((k) => {
      typeSel += '<option value="' + k + '"' + (it.type === k ? " selected" : "") + ">" +
                 Live.ITEM_TYPES[k].label + "</option>";
    });
    typeSel += "</select>";

    let corrSel = '<select id="imCorrect"><option value="">なし (集計のみ)</option>';
    for (let i = 0; i < 6; i++) {
      corrSel += '<option value="' + i + '"' + (it.correct === i ? " selected" : "") + ">" + ABC[i] + "</option>";
    }
    corrSel += "</select>";

    UI.modal({
      title: isNew ? "問題を追加" : "問題を編集",
      bodyHTML:
        '<div class="field"><label>種類</label>' + typeSel + "</div>" +
        '<div class="field"><label>問題文</label><textarea id="imQ" style="min-height:80px">' + UI.esc(it.q) + "</textarea></div>" +

        '<div data-tp="choice"><div class="field"><label>選択肢 <span class="hint">1行に1つ (2〜6個)</span></label>' +
        '<textarea id="imOpts" style="min-height:90px">' + UI.esc((it.options || []).join("\n")) + "</textarea></div>" +
        '<div class="field"><label>正解</label>' + corrSel + "</div></div>" +

        '<div data-tp="scale"><div class="editor-grid">' +
        '<div class="field"><label>1側のことば</label><input type="text" id="imLeft" value="' + UI.esc(it.left || "") + '" placeholder="そう思わない"></div>' +
        '<div class="field"><label>5側のことば</label><input type="text" id="imRight" value="' + UI.esc(it.right || "") + '" placeholder="そう思う"></div></div></div>' +

        '<div data-tp="numeric"><div class="editor-grid">' +
        '<div class="field"><label>正解の値 <span class="hint">例: 6.0×10^23</span></label>' +
        '<input type="text" id="imCVal" style="font-family:var(--font-mono)" value="' + UI.esc(it.correct != null && it.type === "numeric" ? it.correct : "") + '"></div>' +
        '<div class="field"><label>単位 (表示用)</label><input type="text" id="imUnit" value="' + UI.esc(it.unit || "") + '" placeholder="個 / mol / g など"></div>' +
        '<div class="field"><label>許容誤差 (±%)</label><input type="text" id="imTol" style="font-family:var(--font-mono)" value="' + UI.esc(it.tol != null ? it.tol : 1) + '"></div>' +
        "</div></div>",
      okText: isNew ? "追加" : "決定",
      onOpen: (root) => {
        const sync = () => {
          const t = root.querySelector("#imType").value;
          root.querySelectorAll("[data-tp]").forEach((z) => {
            z.style.display = (z.dataset.tp === t) ? "" : "none";
          });
        };
        root.querySelector("#imType").addEventListener("change", sync);
        sync();
      },
      onOk: (root) => {
        const type = root.querySelector("#imType").value;
        const q = root.querySelector("#imQ").value.trim();
        if (!q) { UI.toast("問題文を入力してください", "err"); return false; }
        const next = { id: it.id || UI.newId("q"), type, q };
        if (type === "choice") {
          const opts = root.querySelector("#imOpts").value.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 6);
          if (opts.length < 2) { UI.toast("選択肢は2つ以上必要です", "err"); return false; }
          const cv = root.querySelector("#imCorrect").value;
          const corr = cv === "" ? null : Number(cv);
          if (corr != null && corr >= opts.length) { UI.toast("正解が選択肢の数を超えています", "err"); return false; }
          next.options = opts; next.correct = corr;
        } else if (type === "scale") {
          next.left = root.querySelector("#imLeft").value.trim();
          next.right = root.querySelector("#imRight").value.trim();
        } else if (type === "numeric") {
          const cval = root.querySelector("#imCVal").value.trim();
          if (cval && isNaN(Live.normalizeNumeric(cval))) { UI.toast("正解の値が数として読めません", "err"); return false; }
          next.correct = cval || null;
          next.unit = root.querySelector("#imUnit").value.trim();
          next.tol = Number(root.querySelector("#imTol").value) || 1;
        }
        if (isNew) d.items.push(next); else d.items[index] = next;
        dirty(); renderEditor();
      }
    });
  }

  /* ================= セッション開始 / 再開 ================= */
  async function startSession(deckId) {
    // 最新デッキを取得
    let deck;
    try {
      const res = await adminPost("getDeck", { id: deckId });
      if (!res.ok) throw new Error(res.error);
      deck = res.deck;
    } catch (e) { if (e.message !== "AUTH") UI.toast("デッキを読み込めませんでした", "err"); return; }
    if (!deck.items || !deck.items.length) return UI.toast("問題が1つもありません。先に編集してください", "err");

    $app.innerHTML = '<div class="loading"><div class="spin"></div>ライブを準備中…</div>';
    const sid = Live.randId("ls");

    // 参加コードを確保 (衝突・12時間以内の使用中コードは再抽選)
    let code = "";
    for (let tryN = 0; tryN < 8; tryN++) {
      const c = Live.randCode(4);
      const result = await T.db.ref("codes/" + c).transaction((cur) => {
        if (cur && Date.now() - (cur.t || 0) < 12 * 3600 * 1000) return; // 使用中 → 中止
        return { sid: sid, t: Date.now() };
      });
      if (result.committed) { code = c; break; }
    }
    if (!code) { UI.toast("コードを確保できませんでした。もう一度お試しください", "err"); return renderHome(); }

    // 生徒に見せてよい情報だけをセッションへコピー (正解は含めない)
    const pubItems = deck.items.map((it) => {
      const p = { type: it.type, q: it.q };
      if (it.type === "choice") p.options = it.options;
      if (it.type === "scale") { p.left = it.left || ""; p.right = it.right || ""; }
      if (it.type === "numeric") p.unit = it.unit || "";
      return p;
    });
    await T.db.ref("sessions/" + sid).set({
      meta: { hostUid: T.uid, title: deck.title, deckId: deck.id, code: code,
              createdAt: firebase.database.ServerValue.TIMESTAMP, status: "live" },
      state: { index: -1, phase: "lobby" },
      items: pubItems
    });

    localStorage.setItem(RESUME_KEY, JSON.stringify({ sid, code, deckId: deck.id, title: deck.title }));
    attachRunner(sid, code, deck);
  }

  async function resumeSession(resume) {
    $app.innerHTML = '<div class="loading"><div class="spin"></div>再接続中…</div>';
    try {
      const meta = await T.db.ref("sessions/" + resume.sid + "/meta").get();
      if (!meta.exists() || meta.val().status === "ended") {
        localStorage.removeItem(RESUME_KEY);
        UI.toast("そのライブはすでに終了しています", "err");
        return renderHome();
      }
      const res = await adminPost("getDeck", { id: resume.deckId });
      if (!res.ok) throw new Error(res.error);
      attachRunner(resume.sid, resume.code, res.deck);
    } catch (e) {
      if (e.message !== "AUTH") { UI.toast("再開できませんでした", "err"); renderHome(); }
    }
  }

  /* ================= ランナー (進行画面) ================= */
  function attachRunner(sid, code, deck) {
    T.run = { sid, code, deck, state: { index: -1, phase: "lobby" }, presenceN: 0,
              answers: {}, subs: [], ansRef: null, hiddenText: new Set() };
    const r = T.run;

    const sub = (ref, cb) => { ref.on("value", cb); r.subs.push([ref, cb]); };
    sub(T.db.ref("sessions/" + sid + "/state"), (s) => {
      r.state = s.val() || r.state;
      watchAnswers();
      renderRunner();
    });
    sub(T.db.ref("sessions/" + sid + "/presence"), (s) => {
      r.presenceN = s.numChildren();
      const el = document.getElementById("runJoined");
      if (el) el.textContent = r.presenceN + "人 参加中";
      const el2 = document.getElementById("lobbyNames");
      if (el2) {
        const names = [];
        s.forEach(c => { names.push(c.val().name || "?"); });
        el2.textContent = names.join("・");
      }
    });
  }

  function watchAnswers() {
    const r = T.run;
    const idx = r.state.index;
    if (idx < 0) return;
    if (r.ansRef && r.ansIdx === idx) return; // すでに購読中
    if (r.ansRef) r.ansRef.off();
    r.ansIdx = idx;
    r.ansRef = T.db.ref("sessions/" + r.sid + "/answers/" + idx);
    r.ansRef.on("value", (s) => {
      const list = [];
      s.forEach(c => { const v = c.val(); v._uid = c.key; list.push(v); });
      r.answers[idx] = list;
      renderResults();
      const el = document.getElementById("runAns");
      if (el) el.textContent = "回答 " + list.length + "/" + r.presenceN;
    });
  }

  function detachRunner() {
    const r = T.run;
    if (!r) return;
    r.subs.forEach(([ref, cb]) => ref.off("value", cb));
    if (r.ansRef) r.ansRef.off();
    T.run = null;
  }

  function studentJoinUrl(sid) {
    return location.origin + location.pathname.replace(/teacher\.html.*$/, "student.html") + "?s=" + sid;
  }

  function renderRunner() {
    const r = T.run;
    const st = r.state;
    const total = r.deck.items.length;
    const it = st.index >= 0 ? r.deck.items[st.index] : null;

    const phaseLabel = { lobby: "受付中 (ロビー)", q: "回答受付中", closed: "締め切り", reveal: "答え合わせ", ended: "終了" }[st.phase] || st.phase;

    let h = '<div class="join-banner"><div>' +
            '<div class="sub">参加コード ▼ スクリーンに映してください</div>' +
            '<div class="join-code">' + UI.esc(r.code) + "</div>" +
            '<div class="sub">' + UI.esc(studentJoinUrl(r.sid)) + "</div></div>" +
            '<div class="qr" id="runQr"></div></div>';

    h += '<div class="pillbar">' +
         '<span class="pill hot">' + UI.esc(phaseLabel) + "</span>" +
         '<span class="pill" id="runJoined">' + r.presenceN + "人 参加中</span>" +
         (st.index >= 0 ? '<span class="pill">Q' + (st.index + 1) + " / " + total + "</span>" +
          '<span class="pill ok" id="runAns">回答 ' + ((r.answers[st.index] || []).length) + "/" + r.presenceN + "</span>" : "") +
         "</div>";

    if (st.phase === "lobby") {
      h += '<div class="panel"><h3>参加を待っています…</h3>' +
           '<p style="font-size:13.5px;color:var(--ink-soft);margin:0 0 8px">生徒はポータルの「ライブ授業に参加」ボタン、またはQR・コードから入れます。</p>' +
           '<p id="lobbyNames" style="font-size:14px;min-height:1.5em"></p></div>';
    } else if (it) {
      h += '<div class="q-card"><div class="q-no">Q' + (st.index + 1) + " · " + Live.ITEM_TYPES[it.type].label + "</div>" +
           '<div class="q-text">' + UI.esc(it.q) + "</div>" +
           '<div id="resultZone"></div></div>';
    }

    // 進行コントロール
    h += '<div class="run-controls">';
    if (st.phase === "lobby") {
      h += '<button class="btn btn-live" data-c="first"><span class="dot"></span>最初の問題へ</button>';
    } else {
      if (st.phase === "q") h += '<button class="btn btn-review" data-c="close">回答を締め切る</button>';
      if (st.phase === "closed") {
        h += '<button class="btn btn-primary" data-c="reveal">答えを見せる</button>' +
             '<button class="btn btn-ghost" data-c="reopen">受付を再開</button>';
      }
      if (st.phase === "reveal" || st.phase === "closed") {
        if (st.index < total - 1) h += '<button class="btn btn-live" data-c="next"><span class="dot"></span>次の問題へ</button>';
      }
      if (st.index > 0) h += '<button class="btn btn-ghost" data-c="prev">← 前へ</button>';
    }
    h += '<button class="btn btn-danger" data-c="end">ライブを終了</button></div>';

    $app.innerHTML = h;

    // QR
    try {
      const qr = qrcode(0, "M");
      qr.addData(studentJoinUrl(r.sid)); qr.make();
      document.getElementById("runQr").innerHTML = '<img alt="参加QR" src="' + qr.createDataURL(4, 6) + '">';
    } catch (e) { /* CDN未読込などは無視 */ }

    $app.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => control(b.dataset.c)));
    renderResults();
  }

  async function control(cmd) {
    const r = T.run;
    const st = r.state;
    const sref = T.db.ref("sessions/" + r.sid + "/state");
    try {
      if (cmd === "first") await sref.set({ index: 0, phase: "q" });
      else if (cmd === "close") await sref.update({ phase: "closed" });
      else if (cmd === "reopen") await sref.update({ phase: "q" });
      else if (cmd === "reveal") {
        const it = r.deck.items[st.index];
        const reveal = {};
        if (it.type === "choice" && it.correct != null) reveal.correct = it.correct;
        if (it.type === "numeric" && it.correct) { reveal.correct = it.correct; reveal.tol = it.tol || 1; }
        await sref.update({ phase: "reveal", reveal: reveal });
      }
      else if (cmd === "next") await sref.set({ index: st.index + 1, phase: "q" });
      else if (cmd === "prev") await sref.set({ index: st.index - 1, phase: "q" });
      else if (cmd === "end") endSession();
    } catch (e) { UI.toast("操作に失敗しました", "err"); }
  }

  /* --- リアルタイム集計表示 --- */
  function renderResults() {
    const zone = document.getElementById("resultZone");
    const r = T.run;
    if (!zone || !r || r.state.index < 0) return;
    const it = r.deck.items[r.state.index];
    const list = r.answers[r.state.index] || [];
    const revealed = r.state.phase === "reveal";
    let h = "";

    if (it.type === "choice") {
      const counts = it.options.map(() => 0);
      list.forEach(a => { if (typeof a.v === "number" && counts[a.v] != null) counts[a.v]++; });
      const max = Math.max(1, ...counts);
      h += '<div class="bars">';
      it.options.forEach((op, i) => {
        h += '<div class="bar-row' + (revealed && it.correct === i ? " correct" : "") + '">' +
             '<div class="bar-label">' + ABC[i] + ". " + UI.esc(op) + "</div>" +
             '<div class="bar-track"><div class="bar-fill" style="--bar-c:' + UI.flame(FLAMES[i % FLAMES.length]).css +
             ";width:" + Math.round(counts[i] / max * 100) + '%"></div></div>' +
             '<div class="bar-count">' + counts[i] + "人</div></div>";
      });
      h += "</div>";
    } else if (it.type === "scale") {
      const counts = [0, 0, 0, 0, 0, 0];
      let sum = 0, n = 0;
      list.forEach(a => { const v = Number(a.v); if (v >= 1 && v <= 5) { counts[v]++; sum += v; n++; } });
      const max = Math.max(1, ...counts.slice(1));
      h += '<div class="bars">';
      for (let i = 1; i <= 5; i++) {
        h += '<div class="bar-row"><div class="bar-label">' + i + "</div>" +
             '<div class="bar-track"><div class="bar-fill" style="--bar-c:var(--na);width:' +
             Math.round(counts[i] / max * 100) + '%"></div></div>' +
             '<div class="bar-count">' + counts[i] + "人</div></div>";
      }
      h += '</div><p style="color:var(--ink-soft);font-size:13.5px">平均 ' + (n ? (sum / n).toFixed(2) : "-") +
           " (1: " + UI.esc(it.left || "そう思わない") + " 〜 5: " + UI.esc(it.right || "そう思う") + ")</p>";
    } else if (it.type === "text") {
      h += '<div class="text-wall">';
      list.forEach((a) => {
        const hid = r.hiddenText.has(a._uid);
        h += '<div class="text-card' + (hid ? " hidden-card" : "") + '"><span class="who">' + UI.esc(a.name || "") + "</span>" +
             '<span style="min-width:0">' + UI.esc(String(a.v)) + "</span>" +
             '<button class="icon-btn hide-btn" data-uid="' + UI.esc(a._uid) + '" title="表示/非表示">' + (hid ? "👁" : "🙈") + "</button></div>";
      });
      h += "</div>";
      if (!list.length) h += '<p style="color:var(--ink-soft);font-size:13.5px">回答を待っています…</p>';
    } else if (it.type === "numeric") {
      const hasC = !!it.correct;
      let okN = 0;
      h += '<div class="num-list">';
      list.forEach((a) => {
        const ok = hasC && Live.numericMatch(a.v, it.correct, it.tol);
        if (ok) okN++;
        h += '<span class="num-chip' + (hasC ? (ok ? " right" : " wrong") : "") + '" title="' + UI.esc(a.name || "") + '">' +
             UI.esc(String(a.v)) + "</span>";
      });
      h += "</div>";
      if (hasC) h += '<p style="color:var(--ink-soft);font-size:13.5px">正解 ' + okN + " / " + list.length +
                     '人 · 正解値 <b style="font-family:var(--font-mono)">' + UI.esc(it.correct) +
                     (it.unit ? " " + UI.esc(it.unit) : "") + "</b> (±" + (it.tol || 1) + "%)</p>";
    }
    zone.innerHTML = h;

    zone.querySelectorAll(".hide-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const uid = b.dataset.uid;
        r.hiddenText.has(uid) ? r.hiddenText.delete(uid) : r.hiddenText.add(uid);
        renderResults();
      });
    });
  }

  /* ================= 終了と結果保存 ================= */
  async function endSession() {
    const r = T.run;
    const ok = await UI.modal({
      title: "ライブを終了",
      bodyHTML: "<p>ライブを終了し、結果をDriveに保存します。よろしいですか?</p>",
      okText: "終了して保存"
    });
    if (!ok) return;
    $app.innerHTML = '<div class="loading"><div class="spin"></div>結果を集計・保存中…</div>';

    try {
      await T.db.ref("sessions/" + r.sid + "/state").update({ phase: "ended" });
      await T.db.ref("sessions/" + r.sid + "/meta/status").set("ended");
      const snap = await T.db.ref("sessions/" + r.sid + "/answers").get();
      const answers = snap.val() || {};

      const result = {
        sid: r.sid, code: r.code, deckId: r.deck.id, title: r.deck.title,
        endedAt: Date.now(), items: r.deck.items, answers: answers
      };
      let saved = false;
      try {
        const res = await adminPost("saveResult", { result });
        saved = !!res.ok;
      } catch (e) { /* 保存失敗でもCSVで救済 */ }

      localStorage.removeItem(RESUME_KEY);
      detachRunnerKeep(r);
      T.run = null; // 終了後はページ離脱警告を出さない
      renderEndScreen(r, result, saved);
    } catch (e) {
      UI.toast("終了処理に失敗しました", "err");
      renderRunner();
    }
  }
  function detachRunnerKeep(r) {
    r.subs.forEach(([ref, cb]) => ref.off("value", cb));
    if (r.ansRef) r.ansRef.off();
  }

  function renderEndScreen(r, result, saved) {
    let h = '<div class="section-head"><h2 class="section-title">🏁 ライブ終了</h2></div>' +
            '<div class="panel"><h3>' + UI.esc(result.title) + "</h3>" +
            '<p style="font-size:14px;margin:0 0 4px">結果の保存: ' +
            (saved ? '<b style="color:var(--ba-deep)">Driveに保存しました ✓</b> (ChemPortal/results)' :
                     '<b style="color:var(--sr-deep)">保存に失敗</b> — 下のCSVで手元に残してください') + "</p></div>";

    // 問題ごとのミニ集計
    result.items.forEach((it, i) => {
      const list = Object.values(result.answers[i] || {});
      let line = "回答 " + list.length + "人";
      if (it.type === "choice" && it.correct != null) {
        const okN = list.filter(a => a.v === it.correct).length;
        line += " / 正解 " + okN + "人 (" + (list.length ? Math.round(okN / list.length * 100) : 0) + "%)";
      }
      if (it.type === "numeric" && it.correct) {
        const okN = list.filter(a => Live.numericMatch(a.v, it.correct, it.tol)).length;
        line += " / 正解 " + okN + "人 (" + (list.length ? Math.round(okN / list.length * 100) : 0) + "%)";
      }
      h += '<div class="item-card"><div class="head">' +
           '<span class="row-badge" style="width:38px;height:38px;font-size:15px">Q' + (i + 1) + "</span>" +
           '<span style="flex:1;font-weight:700;font-size:14.5px">' + UI.esc(it.q) + "</span>" +
           '<span class="pill">' + line + "</span></div></div>";
    });

    h += '<div class="run-controls">' +
         '<button class="btn btn-primary" id="csvBtn">CSVをダウンロード</button>' +
         '<button class="btn btn-danger" id="fbDelBtn">Firebaseからセッションを削除</button>' +
         '<button class="btn btn-ghost" id="homeBtn">ホームへ</button></div>';
    $app.innerHTML = h;

    document.getElementById("csvBtn").onclick = () => downloadCsv(result);
    document.getElementById("homeBtn").onclick = renderHome;
    document.getElementById("fbDelBtn").onclick = async (e) => {
      try {
        await T.db.ref("sessions/" + r.sid).remove();
        e.target.disabled = true; e.target.textContent = "削除しました ✓";
        UI.toast("Firebaseから削除しました (容量節約)", "ok");
      } catch (err) { UI.toast("削除に失敗しました", "err"); }
    };
  }

  function downloadCsv(result) {
    const rows = [["問題番号", "種類", "問題文", "ニックネーム", "回答", "正誤", "時刻"]];
    result.items.forEach((it, i) => {
      const map = result.answers[i] || {};
      Object.keys(map).forEach((uid) => {
        const a = map[uid];
        let mark = "";
        if (it.type === "choice" && it.correct != null) mark = (a.v === it.correct) ? "○" : "×";
        if (it.type === "numeric" && it.correct) mark = Live.numericMatch(a.v, it.correct, it.tol) ? "○" : "×";
        const disp = (it.type === "choice") ? (ABC[a.v] || a.v) : a.v;
        rows.push(["Q" + (i + 1), Live.ITEM_TYPES[it.type].label, it.q, a.name || "",
                   String(disp), mark, a.t ? new Date(a.t).toLocaleString("ja-JP") : ""]);
      });
    });
    const csv = "\uFEFF" + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "live_" + result.title.replace(/[\\/:*?"<>|]/g, "_") + "_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  window.addEventListener("beforeunload", (e) => {
    if (T.run) { e.preventDefault(); e.returnValue = ""; }
  });

  boot();
})();
