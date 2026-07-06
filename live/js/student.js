/* =========================================================
   live/js/student.js — 生徒用ライブ授業 (student.html)
   参加はコード入力かQR (?s=セッションID)。ニックネームのみで
   個人情報は扱わない。回答は締め切りまで何度でも変更可。
   ========================================================= */
(() => {
  const $app = document.getElementById("app");
  const NAME_KEY = "cp_live_name_v1";

  const S = {
    db: null, uid: null,
    sid: null, code: "",
    state: null,          // {index, phase}
    item: null,           // 現在の問題 (公開情報のみ)
    itemIndex: -1,
    myAnswer: null,
    subs: []              // 解除用 [ref, event, cb]
  };

  function on(ref, ev, cb) { ref.on(ev, cb); S.subs.push([ref, ev, cb]); }
  function offAll() { S.subs.forEach(([r, e, c]) => r.off(e, c)); S.subs = []; }

  /* ================= 起動 ================= */
  async function boot() {
    if (!Live.configured()) {
      return msgScreen("🔧", "準備中です", "ライブ授業の設定がまだ完了していません。先生に伝えてください。");
    }
    try {
      const { db, uid } = await Live.init();
      S.db = db; S.uid = uid;
    } catch (e) {
      const t = e.message === "ANON_OFF"
        ? "Firebaseの匿名ログインが無効です。先生に伝えてください。"
        : "接続できませんでした。通信環境を確認して再読み込みしてください。";
      return msgScreen("📡", "接続エラー", t);
    }
    const sid = new URLSearchParams(location.search).get("s");
    if (sid) joinBySid(sid);
    else renderJoin();
  }

  function msgScreen(emoji, title, text, extraHTML) {
    $app.innerHTML =
      '<div class="stage"><div class="stage-msg"><div class="big">' + emoji + "</div>" +
      "<h2>" + UI.esc(title) + "</h2><p>" + UI.esc(text) + "</p>" +
      (extraHTML || "") + "</div></div>";
  }

  /* ================= 参加 ================= */
  function renderJoin(prefillCode) {
    $app.innerHTML =
      '<div class="stage"><div class="q-card" style="border-top-color:var(--cu)">' +
      '<h2 style="font-family:var(--font-display);margin:0 0 6px">ライブ授業に参加</h2>' +
      '<p style="color:var(--ink-soft);font-size:13.5px;margin:0 0 14px">スクリーンに表示されている4文字のコードを入力してね。</p>' +
      '<div class="field"><label>参加コード</label>' +
      '<input type="text" id="jCode" maxlength="4" autocomplete="off" autocapitalize="characters" ' +
      'style="font-family:var(--font-mono);font-size:30px;letter-spacing:.35em;text-align:center;text-transform:uppercase" value="' +
      UI.esc(prefillCode || "") + '"></div>' +
      '<div class="field"><label>ニックネーム <span class="hint">本名以外でOK・あとで先生の画面に表示されます</span></label>' +
      '<input type="text" id="jName" maxlength="20" value="' + UI.esc(localStorage.getItem(NAME_KEY) || "") + '"></div>' +
      '<button class="btn btn-primary" id="jGo" style="width:100%">参加する</button>' +
      "</div></div>";
    const go = async () => {
      const code = document.getElementById("jCode").value.trim().toUpperCase();
      const name = document.getElementById("jName").value.trim();
      if (code.length !== 4) return UI.toast("コードは4文字です", "err");
      if (!name) return UI.toast("ニックネームを入力してね", "err");
      localStorage.setItem(NAME_KEY, name);
      const btn = document.getElementById("jGo");
      btn.disabled = true; btn.textContent = "さがしています…";
      try {
        const snap = await S.db.ref("codes/" + code).get();
        if (!snap.exists()) {
          UI.toast("そのコードのライブは見つかりません", "err");
          btn.disabled = false; btn.textContent = "参加する";
          return;
        }
        joinBySid(snap.val().sid);
      } catch (e) {
        UI.toast("接続に失敗しました", "err");
        btn.disabled = false; btn.textContent = "参加する";
      }
    };
    document.getElementById("jGo").addEventListener("click", go);
    document.getElementById("jCode").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  async function joinBySid(sid) {
    let name = localStorage.getItem(NAME_KEY) || "";
    if (!name) {
      // QR直リンクで名前未設定の場合はコード入力画面に (sidは保持)
      const snap = await S.db.ref("sessions/" + sid + "/meta/code").get().catch(() => null);
      return renderJoin(snap && snap.exists() ? snap.val() : "");
    }
    $app.innerHTML = '<div class="loading"><div class="spin"></div>参加しています…</div>';
    try {
      const meta = await S.db.ref("sessions/" + sid + "/meta").get();
      if (!meta.exists()) return msgScreen("🔍", "見つかりません", "このライブは存在しないか、削除されました。");
      if (meta.val().status === "ended") return msgScreen("🏁", "このライブは終了しました", "おつかれさま!");
      S.sid = sid;
      // 在室登録 (切断で自動削除)
      const pref = S.db.ref("sessions/" + sid + "/presence/" + S.uid);
      pref.onDisconnect().remove();
      await pref.set({ name: name, t: firebase.database.ServerValue.TIMESTAMP });
      // 進行状態を購読
      on(S.db.ref("sessions/" + sid + "/state"), "value", (snap) => {
        S.state = snap.val() || { index: -1, phase: "lobby" };
        onStateChange();
      });
    } catch (e) {
      msgScreen("📡", "参加できませんでした", "通信環境を確認して再読み込みしてください。");
    }
  }

  /* ================= 進行 ================= */
  async function onStateChange() {
    const st = S.state;
    if (!st || st.phase === "lobby" || st.index < 0) return renderLobby();
    if (st.phase === "ended") { offAllAnswers(); return msgScreen("🎉", "ライブ終了!", "参加ありがとう。おつかれさま!"); }

    // 問題が変わったら取得し直し
    if (st.index !== S.itemIndex) {
      S.itemIndex = st.index;
      S.item = null; S.myAnswer = null;
      const [itemSnap, mySnap] = await Promise.all([
        S.db.ref("sessions/" + S.sid + "/items/" + st.index).get(),
        S.db.ref("sessions/" + S.sid + "/answers/" + st.index + "/" + S.uid).get().catch(() => null)
      ]);
      S.item = itemSnap.val();
      if (mySnap && mySnap.exists()) S.myAnswer = mySnap.val().v;
    }
    if (!S.item) return msgScreen("⏳", "待っていてね", "先生が問題を準備しています。");

    if (st.phase === "q") renderQuestion(true);
    else if (st.phase === "closed") renderQuestion(false);
    else if (st.phase === "reveal") renderReveal();
  }

  function renderLobby() {
    msgScreen("🧪", "まもなくはじまります", "先生がスタートするまで待っていてね。");
    const zone = UI.el('<p style="margin-top:10px;font-family:var(--font-mono);color:var(--ink-soft)" id="lobbyCount"></p>');
    $app.querySelector(".stage-msg").appendChild(zone);
    on(S.db.ref("sessions/" + S.sid + "/presence"), "value", (snap) => {
      const el = document.getElementById("lobbyCount");
      if (el) el.textContent = "いま " + snap.numChildren() + " 人が参加中";
    });
  }

  /* ---------- 出題画面 ---------- */
  function qHead() {
    return '<div class="q-card"><div class="q-no">Q' + (S.itemIndex + 1) + "</div>" +
           '<div class="q-text">' + UI.esc(S.item.q) + "</div></div>";
  }

  function renderQuestion(open) {
    const it = S.item;
    let h = '<div class="stage">' + qHead();
    if (!open) {
      h += '<div class="stage-msg" style="padding:24px 0"><div class="big">⏱️</div><h2>締め切りました</h2>' +
           "<p>" + (S.myAnswer != null ? "あなたの回答: " + UI.esc(fmtMy(it, S.myAnswer)) : "答え合わせを待ってね") + "</p></div></div>";
      $app.innerHTML = h;
      return;
    }

    if (it.type === "choice") {
      const flames = ["sr", "cu", "na", "k", "ba", "li"];
      h += '<div class="opt-grid">';
      (it.options || []).forEach((op, i) => {
        const f = UI.flame(flames[i % flames.length]);
        h += '<button class="opt-btn' + (S.myAnswer === i ? " mine" : "") + '" data-i="' + i + '">' +
             '<span class="key" style="background:' + f.css + '">' + "ABCDEF"[i] + "</span>" +
             UI.esc(op) + "</button>";
      });
      h += "</div>";
    } else if (it.type === "scale") {
      h += '<div class="scale-row">';
      for (let i = 1; i <= 5; i++) {
        h += '<button class="scale-btn' + (S.myAnswer === i ? " mine" : "") + '" data-i="' + i + '">' + i + "</button>";
      }
      h += "</div>" +
           '<div class="scale-ends"><span>' + UI.esc(it.left || "そう思わない") + "</span><span>" +
           UI.esc(it.right || "そう思う") + "</span></div>";
    } else if (it.type === "text") {
      h += '<div class="field"><textarea id="ansText" maxlength="500" placeholder="ここに入力">' +
           UI.esc(S.myAnswer || "") + "</textarea></div>" +
           '<button class="btn btn-primary" id="ansSend" style="width:100%">送信する</button>';
    } else if (it.type === "numeric") {
      h += '<div class="field"><label>答え' + (it.unit ? " (単位: " + UI.esc(it.unit) + ")" : "") +
           ' <span class="hint">例: 6.0×10^23 / 6.0*10^23 / 0.05</span></label>' +
           '<input type="text" id="ansNum" inputmode="text" autocomplete="off" ' +
           'style="font-family:var(--font-mono);font-size:20px;text-align:center" value="' + UI.esc(S.myAnswer || "") + '"></div>' +
           '<div style="display:flex;gap:8px;margin:-6px 0 12px">' +
           '<button class="btn btn-ghost" id="kExp" style="flex:1">×10^ を入れる</button></div>' +
           '<button class="btn btn-primary" id="ansSend" style="width:100%">送信する</button>';
    }

    if (S.myAnswer != null) h += '<p class="answered-note">✓ 回答ずみ (締め切りまで変更できます)</p>';
    h += "</div>";
    $app.innerHTML = h;

    // イベント
    $app.querySelectorAll(".opt-btn").forEach(b =>
      b.addEventListener("click", () => submit(Number(b.dataset.i))));
    $app.querySelectorAll(".scale-btn").forEach(b =>
      b.addEventListener("click", () => submit(Number(b.dataset.i))));
    const send = document.getElementById("ansSend");
    if (send) send.addEventListener("click", () => {
      if (it.type === "text") {
        const v = document.getElementById("ansText").value.trim();
        if (!v) return UI.toast("入力してから送信してね", "err");
        submit(v);
      } else {
        const v = document.getElementById("ansNum").value.trim();
        if (!v) return UI.toast("入力してから送信してね", "err");
        if (isNaN(Live.normalizeNumeric(v))) return UI.toast("数として読めません。例: 6.0×10^23", "err");
        submit(v);
      }
    });
    const kExp = document.getElementById("kExp");
    if (kExp) kExp.addEventListener("click", () => {
      const inp = document.getElementById("ansNum");
      inp.value += "×10^";
      inp.focus();
    });
  }

  async function submit(v) {
    try {
      await S.db.ref("sessions/" + S.sid + "/answers/" + S.itemIndex + "/" + S.uid).set({
        v: v,
        name: localStorage.getItem(NAME_KEY) || "?",
        t: firebase.database.ServerValue.TIMESTAMP
      });
      S.myAnswer = v;
      UI.toast("回答を送信しました", "ok");
      if (S.state && S.state.phase === "q") renderQuestion(true);
    } catch (e) {
      UI.toast("送信できませんでした (締め切り後かも)", "err");
    }
  }

  function fmtMy(it, v) {
    if (it.type === "choice") return "ABCDEF"[v] + ". " + ((it.options || [])[v] || "");
    return String(v);
  }

  /* ---------- 答え合わせ ---------- */
  let ansSub = null;
  function offAllAnswers() { if (ansSub) { ansSub[0].off(ansSub[1], ansSub[2]); ansSub = null; } }

  async function renderReveal() {
    const it = S.item;
    const rv = S.state.reveal || {};
    const snap = await S.db.ref("sessions/" + S.sid + "/answers/" + S.itemIndex).get();
    const answers = [];
    snap.forEach(c => { answers.push(c.val()); });

    let h = '<div class="stage">' + qHead();

    if (it.type === "choice") {
      const counts = (it.options || []).map(() => 0);
      answers.forEach(a => { if (typeof a.v === "number" && counts[a.v] != null) counts[a.v]++; });
      const max = Math.max(1, ...counts);
      const flames = ["sr", "cu", "na", "k", "ba", "li"];
      h += '<div class="bars">';
      (it.options || []).forEach((op, i) => {
        const isC = rv.correct === i;
        const isMine = S.myAnswer === i;
        h += '<div class="bar-row' + (isC ? " correct" : "") + '">' +
             '<div class="bar-label">' + "ABCDEF"[i] + ". " + UI.esc(op) + (isMine ? " 👤" : "") + "</div>" +
             '<div class="bar-track"><div class="bar-fill" style="--bar-c:' + UI.flame(flames[i % flames.length]).css +
             ";width:" + Math.round(counts[i] / max * 100) + '%"></div></div>' +
             '<div class="bar-count">' + counts[i] + "人</div></div>";
      });
      h += "</div>";
      if (rv.correct != null) {
        h += '<p class="answered-note" style="color:' + (S.myAnswer === rv.correct ? "var(--ba-deep)" : "var(--sr-deep)") + '">' +
             (S.myAnswer == null ? "正解: " + "ABCDEF"[rv.correct] :
              S.myAnswer === rv.correct ? "🎉 正解!" : "残念… 正解は " + "ABCDEF"[rv.correct]) + "</p>";
      }
    } else if (it.type === "scale") {
      const counts = [0, 0, 0, 0, 0, 0];
      let sum = 0, n = 0;
      answers.forEach(a => { const v = Number(a.v); if (v >= 1 && v <= 5) { counts[v]++; sum += v; n++; } });
      const max = Math.max(1, ...counts.slice(1));
      h += '<div class="bars">';
      for (let i = 1; i <= 5; i++) {
        h += '<div class="bar-row"><div class="bar-label">' + i + (S.myAnswer === i ? " 👤" : "") + "</div>" +
             '<div class="bar-track"><div class="bar-fill" style="--bar-c:var(--na);width:' +
             Math.round(counts[i] / max * 100) + '%"></div></div>' +
             '<div class="bar-count">' + counts[i] + "人</div></div>";
      }
      h += "</div>" +
           '<p class="answered-note" style="color:var(--ink-soft)">平均 ' + (n ? (sum / n).toFixed(2) : "-") + "</p>";
    } else if (it.type === "numeric") {
      const hasC = rv.correct != null && rv.correct !== "";
      if (hasC) {
        const mineOk = S.myAnswer != null && Live.numericMatch(S.myAnswer, rv.correct, rv.tol);
        h += '<div class="stage-msg" style="padding:16px 0"><div class="big">' + (S.myAnswer == null ? "🧮" : mineOk ? "🎉" : "🤏") + "</div>" +
             "<h2>" + (S.myAnswer == null ? "答え" : mineOk ? "正解!" : "おしい!") + "</h2>" +
             '<p>正解: <b style="font-family:var(--font-mono);font-size:20px">' + UI.esc(Live.prettyNumeric(rv.correct)) +
             (it.unit ? " " + UI.esc(it.unit) : "") + "</b>" +
             (S.myAnswer != null ? "<br>あなたの回答: " + UI.esc(S.myAnswer) : "") + "</p></div>";
      }
      const okN = hasC ? answers.filter(a => Live.numericMatch(a.v, rv.correct, rv.tol)).length : 0;
      h += '<p style="text-align:center;color:var(--ink-soft)">回答 ' + answers.length + "人" +
           (hasC ? " / 正解 " + okN + "人" : "") + "</p>";
    } else { // text
      h += '<div class="text-wall">';
      answers.slice(0, 60).forEach(a => {
        h += '<div class="text-card"><span class="who">' + UI.esc(a.name || "") + "</span>" + UI.esc(String(a.v)) + "</div>";
      });
      h += "</div>";
      if (!answers.length) h += '<p style="text-align:center;color:var(--ink-soft)">回答はありませんでした</p>';
    }

    h += "</div>";
    $app.innerHTML = h;
  }

  boot();
})();
