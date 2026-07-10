/* =========================================================
   review/js/review.js — 復習問題エンジン (review/index.html)
   ・?d=デッキID でそのデッキを自分のペースで解く
   ・答えのある問題は即時フィードバック (化学数値の正規化判定つき)
   ・忘却曲線に沿った復習スケジュール:
       1回目(授業当日) → 2回目(翌日) → 3回目(1週間後) → マスター
     ※スケジュールはこの端末のブラウザに記録されます
   ・取り組み結果は先生の復習ログ(スプレッドシート)に記録
   ========================================================= */
(() => {
  const $app = document.getElementById("app");
  const NAME_KEY = "cp_live_name_v1";       // ライブ授業とニックネームを共有
  const SCHED_KEY = "cp_review_sched_v1";
  const ABC = "ABCDEF";
  const FLAMES = ["sr", "cu", "na", "k", "ba", "li"];

  const S = {
    deckId: null, deck: null,
    idx: 0,
    results: [],     // {v, ok(true/false/null)}
    correct: 0, graded: 0
  };

  /* ---------- スケジュール (端末ローカル) ---------- */
  function sched() {
    try { return JSON.parse(localStorage.getItem(SCHED_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSched(o) { localStorage.setItem(SCHED_KEY, JSON.stringify(o)); }
  const DAY = 24 * 3600 * 1000;
  // done回数 → 次の復習までの日数 (忘却曲線: 当日→翌日→1週間後)
  function nextGap(done) { return done === 1 ? 1 : done === 2 ? 7 : null; }
  function stageLabel(done) {
    return done <= 0 ? "1回目" : done === 1 ? "2回目 (翌日の復習)" : done === 2 ? "3回目 (1週間後の復習)" : (done + 1) + "回目";
  }

  /* ---------- 起動 ---------- */
  async function boot() {
    S.deckId = new URLSearchParams(location.search).get("d");
    if (!S.deckId) return renderDueList();
    $app.innerHTML = '<div class="loading"><div class="spin"></div>問題を読み込み中…</div>';
    try {
      const res = await Api.get({ action: "reviewDeck", id: S.deckId });
      if (!res.ok) throw new Error(res.error);
      S.deck = res.deck;
      if (!S.deck.items || !S.deck.items.length) {
        return msg("🃏", "まだ問題がありません", "先生が問題を準備中です。");
      }
      renderIntro();
    } catch (e) {
      const t = (e && e.message === "NOT_FOUND")
        ? "このデッキは見つかりませんでした。"
        : "読み込めませんでした。通信環境を確認して再読み込みしてください。";
      msg("🔍", "エラー", t);
    }
  }

  function msg(emoji, title, text, extraHTML) {
    $app.innerHTML =
      '<div class="stage"><div class="stage-msg"><div class="big">' + emoji + "</div>" +
      "<h2>" + UI.esc(title) + "</h2><p>" + UI.esc(text) + "</p>" + (extraHTML || "") + "</div></div>";
  }

  /* ---------- イントロ ---------- */
  function renderIntro() {
    const d = S.deck;
    const rec = sched()[S.deckId] || { done: 0 };
    const due = rec.next ? new Date(rec.next) : null;
    const now = Date.now();
    let schedNote = "";
    if (rec.done > 0) {
      if (rec.next == null) schedNote = "🏅 このデッキはマスター済み。腕試しにどうぞ!";
      else if (now >= rec.next) schedNote = "⏰ いまが復習のタイミングです (" + stageLabel(rec.done) + ")";
      else schedNote = "次の復習は " + due.toLocaleDateString("ja-JP") + " ごろがおすすめ (早めにやってもOK)";
    } else {
      schedNote = "はじめての挑戦。今日中にやると記憶に残りやすい!";
    }
    $app.innerHTML =
      '<div class="stage"><div class="q-card" style="border-top-color:var(--na)">' +
      '<h2 style="font-family:var(--font-display);margin:0 0 4px">' + UI.esc(d.title) + "</h2>" +
      '<p style="color:var(--ink-soft);font-size:13.5px;margin:0 0 8px">全 ' + d.items.length + " 問 · 自分のペースでOK · 1問ごとに答え合わせ</p>" +
      '<p style="font-size:13.5px;font-weight:700;color:var(--na-deep);margin:0 0 14px">' + UI.esc(schedNote) + "</p>" +
      '<div class="field"><label>ニックネーム <span class="hint">がんばった記録が先生に届きます</span></label>' +
      '<input type="text" id="rvName" maxlength="20" value="' + UI.esc(localStorage.getItem(NAME_KEY) || "") + '"></div>' +
      '<button class="btn btn-primary" id="rvGo" style="width:100%">スタート!</button>' +
      "</div></div>";
    document.getElementById("rvGo").addEventListener("click", () => {
      const name = document.getElementById("rvName").value.trim();
      if (!name) return UI.toast("ニックネームを入力してね", "err");
      localStorage.setItem(NAME_KEY, name);
      S.idx = 0; S.results = []; S.correct = 0; S.graded = 0;
      renderQ();
    });
  }

  /* ---------- 出題 ---------- */
  function head() {
    return '<div class="pillbar" style="justify-content:center">' +
           '<span class="pill hot">Q' + (S.idx + 1) + " / " + S.deck.items.length + "</span>" +
           (S.graded ? '<span class="pill ok">正解 ' + S.correct + "/" + S.graded + "</span>" : "") +
           "</div>";
  }

  function renderQ() {
    const it = S.deck.items[S.idx];
    let h = '<div class="stage">' + head() +
            '<div class="q-card"><div class="q-no">' + Live.ITEM_TYPES[it.type].label + "</div>" +
            '<div class="q-text">' + UI.esc(it.q) + "</div></div>";

    if (it.type === "choice") {
      h += '<div class="opt-grid">';
      (it.options || []).forEach((op, i) => {
        const f = UI.flame(FLAMES[i % FLAMES.length]);
        h += '<button class="opt-btn" data-i="' + i + '">' +
             '<span class="key" style="background:' + f.css + '">' + ABC[i] + "</span>" + UI.esc(op) + "</button>";
      });
      h += "</div>";
    } else if (it.type === "scale") {
      h += '<div class="scale-row">';
      for (let i = 1; i <= 5; i++) h += '<button class="scale-btn" data-i="' + i + '">' + i + "</button>";
      h += '</div><div class="scale-ends"><span>' + UI.esc(it.left || "そう思わない") +
           "</span><span>" + UI.esc(it.right || "そう思う") + "</span></div>";
    } else if (it.type === "text") {
      h += '<div class="field"><textarea id="rvText" maxlength="500" placeholder="自分のことばで書いてみよう"></textarea></div>' +
           '<button class="btn btn-primary" id="rvSend" style="width:100%">これで答える</button>';
    } else if (it.type === "numeric") {
      h += '<div class="field"><label>答え' + (it.unit ? " (単位: " + UI.esc(it.unit) + ")" : "") +
           ' <span class="hint">例: 6.0×10^23 / 6.0*10^23 / 0.05</span></label>' +
           '<input type="text" id="rvNum" autocomplete="off" style="font-family:var(--font-mono);font-size:20px;text-align:center"></div>' +
           '<div style="display:flex;gap:8px;margin:-6px 0 12px">' +
           '<button class="btn btn-ghost" id="rvExp" style="flex:1">×10^ を入れる</button></div>' +
           '<button class="btn btn-primary" id="rvSend" style="width:100%">これで答える</button>';
    }
    h += "</div>";
    $app.innerHTML = h;

    $app.querySelectorAll(".opt-btn").forEach(b => b.addEventListener("click", () => answer(Number(b.dataset.i))));
    $app.querySelectorAll(".scale-btn").forEach(b => b.addEventListener("click", () => answer(Number(b.dataset.i))));
    const send = document.getElementById("rvSend");
    if (send) send.addEventListener("click", () => {
      if (it.type === "text") {
        const v = document.getElementById("rvText").value.trim();
        if (!v) return UI.toast("入力してから答えてね", "err");
        answer(v);
      } else {
        const v = document.getElementById("rvNum").value.trim();
        if (!v) return UI.toast("入力してから答えてね", "err");
        if (isNaN(Live.normalizeNumeric(v))) return UI.toast("数として読めません。例: 6.0×10^23", "err");
        answer(v);
      }
    });
    const exp = document.getElementById("rvExp");
    if (exp) exp.addEventListener("click", () => {
      const inp = document.getElementById("rvNum");
      inp.value += "×10^"; inp.focus();
    });
  }

  /* ---------- 判定と即時フィードバック ---------- */
  function answer(v) {
    const it = S.deck.items[S.idx];
    let ok = null;
    if (it.type === "choice" && it.correct != null) ok = (v === it.correct);
    if (it.type === "numeric" && it.correct) ok = Live.numericMatch(v, it.correct, it.tol);
    if (ok !== null) { S.graded++; if (ok) S.correct++; }
    S.results[S.idx] = { v, ok };
    renderFeedback(it, v, ok);
  }

  function renderFeedback(it, v, ok) {
    let body = "";
    if (ok === true) {
      body = '<div class="big">🎉</div><h2 style="color:var(--ba-deep)">正解!</h2>';
    } else if (ok === false) {
      body = '<div class="big">🤏</div><h2 style="color:var(--sr-deep)">おしい!</h2>';
    } else {
      body = '<div class="big">📝</div><h2>記録しました</h2>';
    }
    let detail = "";
    if (it.type === "choice") {
      detail = "あなた: " + ABC[v] + ". " + UI.esc((it.options || [])[v] || "");
      if (it.correct != null) detail += "<br>正解: <b>" + ABC[it.correct] + ". " + UI.esc(it.options[it.correct]) + "</b>";
    } else if (it.type === "numeric") {
      detail = "あなた: <span style='font-family:var(--font-mono)'>" + UI.esc(String(v)) + "</span>";
      if (it.correct) detail += "<br>正解: <b style='font-family:var(--font-mono);font-size:18px'>" +
        UI.esc(Live.prettyNumeric(it.correct)) + (it.unit ? " " + UI.esc(it.unit) : "") + "</b> (±" + (it.tol || 1) + "%)";
    } else if (it.type === "scale") {
      detail = "あなたの評価: " + UI.esc(String(v));
    }
    const last = S.idx >= S.deck.items.length - 1;
    $app.innerHTML =
      '<div class="stage">' + head() +
      '<div class="q-card" style="border-top-color:' + (ok === false ? "var(--sr)" : "var(--ba)") + '">' +
      '<div class="q-text" style="font-size:15px">' + UI.esc(it.q) + "</div></div>" +
      '<div class="stage-msg" style="padding:18px 0 10px">' + body +
      '<p style="line-height:1.9">' + detail + "</p></div>" +
      '<button class="btn btn-primary" id="rvNext" style="width:100%">' + (last ? "結果を見る" : "次の問題へ →") + "</button></div>";
    document.getElementById("rvNext").addEventListener("click", () => {
      if (last) finish();
      else { S.idx++; renderQ(); }
    });
  }

  /* ---------- 終了 ---------- */
  async function finish() {
    // スケジュール更新
    const all = sched();
    const rec = all[S.deckId] || { done: 0 };
    rec.done++;
    rec.title = S.deck.title;
    const gap = nextGap(rec.done);
    rec.next = gap == null ? null : Date.now() + gap * DAY;
    all[S.deckId] = rec;
    saveSched(all);

    // 先生の復習ログへ記録 (失敗しても結果表示は続ける)
    let logged = false;
    try {
      const res = await Api.post("logReview", {
        deckId: S.deckId, deckTitle: S.deck.title,
        name: localStorage.getItem(NAME_KEY) || "",
        score: S.correct, total: S.graded, stage: rec.done + "回目"
      });
      logged = !!(res && res.ok);
    } catch (e) { /* オフライン等 */ }

    const pct = S.graded ? Math.round(S.correct / S.graded * 100) : null;
    let h = '<div class="stage"><div class="stage-msg" style="padding:34px 0 12px">' +
            '<div class="big">' + (pct == null ? "✅" : pct === 100 ? "🏆" : pct >= 70 ? "🎉" : "💪") + "</div>" +
            "<h2>おつかれさま!</h2>" +
            (pct != null
              ? '<p style="font-family:var(--font-display);font-size:34px;font-weight:800;margin:4px 0;color:var(--cu-deep)">' +
                S.correct + " / " + S.graded + ' <span style="font-size:18px">正解 (' + pct + "%)</span></p>"
              : "<p>すべて記録しました。</p>") +
            "</div>";

    // 1問ごとの結果
    h += '<div class="row-list" style="gap:8px">';
    S.deck.items.forEach((it, i) => {
      const r = S.results[i] || {};
      const mark = r.ok === true ? "🟢" : r.ok === false ? "🔴" : "📝";
      h += '<div class="text-card" style="border-left-color:' +
           (r.ok === true ? "var(--ba)" : r.ok === false ? "var(--sr)" : "var(--line)") + '">' +
           '<span class="who">Q' + (i + 1) + "</span>" + mark + " " + UI.esc(it.q) + "</div>";
    });
    h += "</div>";

    // 次の復習の案内 (忘却曲線)
    h += '<div class="panel" style="margin-top:16px"><h3>🧠 次の復習</h3><p style="margin:0;font-size:14px">' +
         (rec.next == null
           ? "3回の復習が完了! このデッキは<b>マスター</b>です 🏅 (いつでも再挑戦OK)"
           : "おすすめは <b>" + new Date(rec.next).toLocaleDateString("ja-JP") + "</b> ごろ (" + stageLabel(rec.done) + " が終わったところ)。" +
             "<br><span style='font-size:12.5px;color:var(--ink-soft)'>当日→翌日→1週間後 の3回で記憶はぐっと定着します。</span>") +
         (logged ? "" : '<br><span style="font-size:12px;color:var(--sr-deep)">※記録の送信に失敗しました (結果はこの画面でのみ確認できます)</span>') +
         "</p></div>";

    h += '<div class="run-controls">' +
         '<button class="btn btn-primary" id="rvAgain">もう一度</button>' +
         '<button class="btn btn-ghost" id="rvDue">復習リストを見る</button></div></div>';
    $app.innerHTML = h;
    document.getElementById("rvAgain").addEventListener("click", () => { S.idx = 0; S.results = []; S.correct = 0; S.graded = 0; renderQ(); });
    document.getElementById("rvDue").addEventListener("click", () => { history.replaceState(null, "", location.pathname); renderDueList(); });
  }

  /* ---------- 復習リスト (この端末の記録) ---------- */
  function renderDueList() {
    const all = sched();
    const ids = Object.keys(all);
    let h = '<div class="stage"><div class="section-head"><h2 class="section-title">復習リスト</h2>' +
            '<span class="section-note">この端末での記録</span></div>';
    if (!ids.length) {
      h += '<div class="empty"><div class="big">📚</div><p>まだ記録がありません。<br>授業ページの「復習問題にちょうせん」から始めよう!</p></div>';
    } else {
      const now = Date.now();
      ids.sort((a, b) => (all[a].next || Infinity) - (all[b].next || Infinity));
      h += '<div class="row-list">';
      ids.forEach((id) => {
        const r = all[id];
        let status, cls = "";
        if (r.next == null) status = "🏅 マスター";
        else if (now >= r.next) { status = "⏰ いまが復習どき!"; cls = ' style="border-color:var(--na)"'; }
        else status = "次: " + new Date(r.next).toLocaleDateString("ja-JP");
        h += '<a class="row-card"' + cls + ' href="?d=' + encodeURIComponent(id) + '">' +
             '<span class="row-badge" style="background:var(--na-pale);color:var(--na-deep)">' + r.done + "回</span>" +
             '<span class="row-main"><span class="row-title">' + UI.esc(r.title || "デッキ") + "</span>" +
             '<span class="row-sub"><span>' + status + "</span></span></span>" +
             '<span class="row-arrow">›</span></a>';
      });
      h += "</div>";
    }
    h += "</div>";
    $app.innerHTML = h;
  }

  boot();
})();
