/* Dinleme testi: dört kayıtlı en iyi / en kötü (BWS) denemeleri.
   Bağımlılık yok. Tasarım: docs/design/2026-10-16-insan-testi-taslagi.md
   Katılımcı kodu bağlantıdan gelir (?p=L001). Yanıtlar tarayıcıda saklanır ve config.json'daki
   `endpoint` varsa oraya gönderilir; yoksa bitişte indirilebilir. `send_mode`: "json" (varsayılan; alıcı
   200-299 döndürür) ya da "text" (Content-Type: text/plain, tarayıcıda ön kontrol isteği yok; alıcı
   {"ok":true} döndürür ve yalnızca bu yanıt "gönderildi" sayılır, örneğin Google Apps Script).
   Bitiş ekranında yanıtlar her zaman yedek olarak indirilebilir. */
(() => {
  "use strict";

  const qs = new URLSearchParams(location.search);
  const DEBUG = qs.get("debug") === "1"; // dinleme şartını gevşetir; olaylara işaretlenir
  const app = document.getElementById("app");

  const AGE = ["18–24", "25–34", "35–44", "45–54", "55 ve üzeri"];
  const DEVICE = ["Kulak üstü kulaklık", "Kulak içi kulaklık", "Laptop veya telefon hoparlörü", "Diğer"];
  const ENV = ["Sessiz bir yer", "Biraz gürültülü", "Gürültülü"];
  const TAGS = [
    ["harmony_or_sound", "Yanlış okunan ses veya ek (ünlü uyumu dahil)"],
    ["stress", "Vurgu"],
    ["number_abbrev", "Sayı veya kısaltma okunuşu"],
    ["cut_repeat", "Kesilme, eksik veya tekrar"],
    ["artifact", "Robotik veya bozuk ses"],
  ];

  // ---------- küçük yardımcılar ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const mem = {};
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return mem[k] ?? null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { mem[k] = v; } },
  };
  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  const show = (...nodes) => { app.replaceChildren(...nodes.flat().filter((n) => n != null && n !== false)); window.scrollTo(0, 0); };

  let cfg, design, code, plan, state;
  const key = () => `bws:${cfg.study_id}:${code}`;
  const save = () => store.set(key(), JSON.stringify(state));

  // ---------- olay kaydı ve gönderim ----------
  function logEvent(type, data) {
    state.events.push({
      event_id: `${code}-${state.events.length + 1}`, study: cfg.study_id, participant: code, type,
      t: Date.now(), debug: DEBUG, ...data,
    });
    save();
    flush();
  }
  let flushing = false;
  let onFlushed = null; // bitiş ekranı, gönderim her bittiğinde kendini yeniler
  async function send(ev) {
    const text = cfg.send_mode === "text";
    const r = await fetch(cfg.endpoint, {
      method: "POST", headers: { "Content-Type": text ? "text/plain;charset=utf-8" : "application/json" }, body: JSON.stringify(ev),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (text) {
      const ack = await r.json().catch(() => null);
      if (!ack || ack.ok !== true) throw new Error("alıcı onaylamadı");
    }
  }
  async function flush() {
    if (!cfg.endpoint || flushing) return;
    flushing = true;
    try {
      while (state.sent < state.events.length) {
        await send(state.events[state.sent]);
        state.sent += 1;
        save();
      }
    } catch (e) {
      console.warn("gönderilemedi, sonra yeniden denenecek:", e.message);
      if (retryCount++ < 20) setTimeout(flush, Math.min(30000, 2000 * retryCount));
    } finally { flushing = false; }
    if (state.sent >= state.events.length) retryCount = 0;
    if (onFlushed) onFlushed();
  }
  let retryCount = 0;
  const unsent = () => (cfg.endpoint ? state.events.length - state.sent : state.events.length);

  // ---------- ekranlar ----------
  async function screenWelcome(err) {
    const consent = await (await fetch(cfg.consent_url, { cache: "no-store" })).text();
    const box = h("div", { class: "consent" });
    box.innerHTML = consent; // kendi dosyamız, kullanıcı girdisi değil
    const input = h("input", { type: "text", id: "code", value: qs.get("p") || "", autocomplete: "off", spellcheck: "false" });
    const chk = h("input", { type: "checkbox", id: "ok" });
    const goBtn = h("button", { class: "primary", disabled: true, onclick: () => start(input.value.trim()) }, "Başla");
    chk.addEventListener("change", () => { goBtn.disabled = !chk.checked; });
    show(
      h("h1", {}, "Türkçe konuşma sentezi dinleme testi"),
      h("p", { class: "muted" }, "Toplam yaklaşık 15–18 dakika, iki kısa oturum. Kulaklık gerekir."),
      err ? h("p", { class: "notice err" }, err) : null,
      box,
      h("label", { class: "field", for: "code" }, "Size verilen katılımcı kodu"),
      input,
      h("p", {}, h("label", {}, chk, " 18 yaşından büyüğüm, bilgilendirme metnini okudum ve gönüllü olarak katılıyorum.")),
      goBtn,
    );
  }

  async function start(c) {
    if (!c || !design.listeners[c]) { return screenWelcome("Bu kod bulunamadı. Bağlantıyı size gönderen kişiyle iletişime geçin."); }
    code = c; plan = design.listeners[code];
    const old = store.get(key());
    state = old ? JSON.parse(old) : { step: "survey", session: 0, idx: 0, practiceIdx: 0, events: [], sent: 0, done: [false, false] };
    if (!old) {
      logEvent("consent", { consent_version: cfg.consent_version, ua: navigator.userAgent, screen: [screen.width, screen.height], lang: navigator.language });
    }
    route();
  }

  function route() {
    ({ survey: screenSurvey, soundcheck: screenSound, instructions: screenInstructions, practice: screenPractice,
       trial: screenTrial, sessionEnd: screenSessionEnd, finish: screenFinish, stop: screenStop })[state.step]();
  }
  const go = (step, extra) => { Object.assign(state, { step }, extra || {}); save(); route(); };

  function select(id, options) {
    return h("select", { id }, h("option", { value: "" }, "Seçin"), options.map((o) => h("option", { value: o }, o)));
  }
  function screenSurvey() {
    const age = select("age", AGE), dev = select("dev", DEVICE), env = select("env", ENV), nat = select("nat", ["Evet", "Hayır"]);
    const hear = h("input", { type: "checkbox", id: "hear" });
    const next = h("button", { class: "primary", onclick: () => {
      const v = { age: age.value, device: dev.value, environment: env.value, native_turkish: nat.value, no_hearing_issue: hear.checked };
      if (!v.age || !v.device || !v.environment || !v.native_turkish) { return alert("Lütfen tüm soruları yanıtlayın."); }
      logEvent("survey", v);
      if (v.native_turkish === "Hayır") return go("stop");
      go("soundcheck");
    } }, "Devam");
    show(
      h("h1", {}, "Kısa bilgi formu"),
      h("p", { class: "muted" }, "Kimliğinizi belirleyecek bir şey sorulmaz."),
      h("label", { class: "field", for: "age" }, "Yaş aralığınız"), age,
      h("label", { class: "field", for: "nat" }, "Türkçe ilk öğrendiğiniz (ana) dil mi?"), nat,
      h("label", { class: "field", for: "dev" }, "Ne ile dinleyeceksiniz?"), dev,
      h("label", { class: "field", for: "env" }, "Bulunduğunuz ortam"), env,
      h("p", {}, h("label", {}, hear, " İşitmemle ilgili bilinen bir sorunum yok.")),
      next,
    );
  }

  function screenStop() {
    show(h("h1", {}, "Teşekkürler"), h("p", {}, "Bu çalışma anadili Türkçe olan katılımcılar için tasarlandı. İlginiz için teşekkür ederiz."));
  }

  function screenSound() {
    let ctx;
    const play = () => {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 440; g.gain.value = 0.1;
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 1.2);
    };
    show(
      h("h1", {}, "Ses kontrolü"),
      h("p", {}, "Kulaklığınızı takın. Aşağıdaki düğmeye basınca bir ses duyacaksınız. Ses düzeyini rahat duyacağınız, ama kulağınızı rahatsız etmeyecek şekilde ayarlayın ve test boyunca değiştirmeyin."),
      h("div", { class: "row" },
        h("button", { onclick: play }, "▶ Sesi çal"),
        h("button", { class: "primary", onclick: () => { logEvent("soundcheck", { ok: true }); go("instructions"); } }, "Net duydum, devam")),
    );
  }

  function screenInstructions() {
    const first = state.session === 0;
    show(
      h("h1", {}, first ? "Nasıl çalışacak?" : "İkinci oturum"),
      h("div", { class: "card" },
        h("p", {}, "Her denemede ", h("b", {}, "aynı cümleyi"), " okuyan ", h("b", {}, "dört kayıt"), " göreceksiniz. Hepsini dinleyin (istediğiniz kadar tekrar dinleyebilirsiniz)."),
        h("p", {}, "Türkçe okunuşta ", h("b", {}, "hatası en ciddi"), " kaydı ", h("b", {}, "EN KÖTÜ"), ", ",
          h("b", {}, "en az hatası olanı"), " ", h("b", {}, "EN İYİ"), " olarak işaretleyin."),
        h("p", {}, "Hata derken: yanlış okunan ses veya ek, vurgu, yanlış okunan sayı veya kısaltma, kesilme veya tekrar, bozuk ses. Sesin hoşunuza gitmesi veya sesin tonu ", h("b", {}, "hata değildir"), "."),
        h("p", {}, "Dördü de iyi olabilir; yine de bir seçim yapın. Doğru ya da yanlış cevap yok.")),
      first ? h("p", { class: "muted" }, "Önce iki alıştırma denemesi var; bunlar kaydedilmez.") : null,
      h("button", { class: "primary", onclick: () => {
        logEvent("session_start", { session: state.session + 1 });
        go(first ? "practice" : "trial", { idx: 0, practiceIdx: 0 });
      } }, first ? "Alıştırmaya başla" : "Başla"),
    );
  }

  function screenPractice() {
    const list = design.practice;
    if (state.practiceIdx >= list.length) return go("trial", { idx: 0 });
    trialView(list[state.practiceIdx], {
      label: `Alıştırma ${state.practiceIdx + 1} / ${list.length}`, progress: state.practiceIdx / list.length, practice: true,
      onDone: (rec) => { logEvent("practice", { trial_id: rec.trial_id, best: rec.best, worst: rec.worst }); go("practice", { practiceIdx: state.practiceIdx + 1 }); },
    });
  }

  function screenTrial() {
    const trials = plan.sessions[state.session];
    if (state.idx >= trials.length) return go("sessionEnd");
    const t = trials[state.idx];
    trialView(t, {
      label: `Deneme ${state.idx + 1} / ${trials.length}`, progress: state.idx / trials.length, practice: false,
      onDone: (rec) => { logEvent("trial", rec); go("trial", { idx: state.idx + 1 }); },
    });
  }

  function trialView(trial, opt) {
    const sel = { best: null, worst: null, tags: new Set() };
    const shownAt = Date.now(), t0 = performance.now();
    const plays = {}, listened = {}, audios = {};
    const need = DEBUG ? 0 : cfg.min_listen_ratio;
    const next = h("button", { class: "primary", disabled: true }, opt.practice ? "Devam" : "Kaydet ve devam");
    const chipBox = h("div", { class: "hidden" });
    const cards = [];

    const refresh = () => {
      const allHeard = trial.clips.every((c) => (listened[c.id] || 0) >= need);
      next.disabled = !(allHeard && sel.best && sel.worst && sel.best !== sel.worst);
      cards.forEach(({ el, id, worstBtn, bestBtn, status }) => {
        el.classList.toggle("is-worst", sel.worst === id);
        el.classList.toggle("is-best", sel.best === id);
        worstBtn.setAttribute("aria-pressed", sel.worst === id);
        bestBtn.setAttribute("aria-pressed", sel.best === id);
        status.textContent = (listened[id] || 0) >= need ? "dinlendi ✓" : "henüz dinlenmedi";
      });
      chipBox.classList.toggle("hidden", !sel.worst);
    };
    const stopAll = () => Object.values(audios).forEach((a) => a.pause());

    trial.clips.forEach((c, i) => {
      const a = new Audio(); a.preload = "auto"; a.src = c.src; audios[c.id] = a;
      plays[c.id] = 0; listened[c.id] = 0;
      const bar = h("span");
      const playBtn = h("button", { "aria-label": `Kayıt ${"ABCD"[i]} oynat` }, "▶");
      const status = h("span", { class: "status" });
      const worstBtn = h("button", { class: "worst", "aria-pressed": false, onclick: () => {
        sel.worst = sel.worst === c.id ? null : c.id; if (sel.best === c.id) sel.best = null; sel.tags.clear(); renderChips(); refresh(); } }, "En kötü");
      const bestBtn = h("button", { class: "best", "aria-pressed": false, onclick: () => {
        sel.best = sel.best === c.id ? null : c.id; if (sel.worst === c.id) { sel.worst = null; sel.tags.clear(); renderChips(); } refresh(); } }, "En iyi");
      playBtn.addEventListener("click", () => {
        if (a.paused) { stopAll(); a.play().catch((e) => console.warn(e.message)); } else a.pause();
      });
      a.addEventListener("play", () => { plays[c.id] += 1; playBtn.textContent = "❚❚"; });
      a.addEventListener("pause", () => { playBtn.textContent = "▶"; });
      a.addEventListener("timeupdate", () => {
        if (isFinite(a.duration) && a.duration > 0) {
          const r = a.currentTime / a.duration; bar.style.width = `${Math.round(r * 100)}%`;
          listened[c.id] = Math.max(listened[c.id], r); refresh();
        }
      });
      a.addEventListener("ended", () => { listened[c.id] = 1; playBtn.textContent = "▶"; refresh(); });
      a.addEventListener("error", () => { status.textContent = "ses dosyası yüklenemedi"; });
      const el = h("div", { class: "card clip" },
        h("div", { class: "tag" }, "ABCD"[i]),
        h("div", {}, h("div", { class: "row" }, playBtn, h("div", { class: "grow" }, h("div", { class: "bar" }, bar))), status),
        h("div", { class: "choices" }, worstBtn, bestBtn));
      cards.push({ el, id: c.id, worstBtn, bestBtn, status });
    });

    function renderChips() {
      chipBox.replaceChildren(
        h("p", { class: "small muted" }, "İsteğe bağlı: EN KÖTÜ seçtiğiniz kayıttaki hata nedir? (birden fazla seçebilirsiniz)"),
        h("div", { class: "chips" }, TAGS.map(([id, label]) => {
          const b = h("button", { "aria-pressed": sel.tags.has(id), onclick: () => {
            sel.tags.has(id) ? sel.tags.delete(id) : sel.tags.add(id); b.setAttribute("aria-pressed", sel.tags.has(id)); } }, label);
          return b;
        })));
    }
    renderChips();

    next.addEventListener("click", () => {
      stopAll();
      const rec = {
        trial_id: trial.trial_id, kind: trial.kind, tuple_id: trial.tuple_id, sentence_id: trial.sentence_id, session: trial.session ?? null,
        repeat_of: trial.repeat_of ?? null, order: trial.clips.map((c) => c.id), best: sel.best, worst: sel.worst,
        tags: [...sel.tags], plays, listened: Object.fromEntries(Object.entries(listened).map(([k, v]) => [k, +v.toFixed(3)])),
        shown_at: shownAt, rt_ms: Math.round(performance.now() - t0),
      };
      opt.onDone(rec);
    });

    show(
      h("div", { class: "row" }, h("b", {}, opt.label), opt.practice ? h("span", { class: "muted small" }, "kaydedilmez") : null),
      h("div", { class: "progress" }, h("span", { style: `width:${Math.round(opt.progress * 100)}%` })),
      h("p", {}, "Dört kayıt aynı cümleyi okuyor. Hatası en ciddi olanı ve en az olanı seçin."),
      ...cards.map((c) => c.el),
      chipBox,
      h("div", { class: "row" }, next),
    );
    refresh();
  }

  function screenSessionEnd() {
    const n = state.session;
    if (!state.done[n]) { state.done[n] = true; logEvent("session_end", { session: n + 1 }); }
    if (n === 0) {
      show(
        h("h1", {}, "Birinci oturum bitti, teşekkürler"),
        h("p", {}, "İkinci oturum yaklaşık 8 dakika sürer. İsterseniz hemen devam edebilir, isterseniz sonra aynı bağlantıyla dönebilirsiniz; kaldığınız yerden sürer."),
        h("div", { class: "row" },
          h("button", { class: "primary", onclick: () => go("instructions", { session: 1, idx: 0 }) }, "İkinci oturuma şimdi başla"),
          h("button", { onclick: () => { state.session = 1; state.step = "instructions"; state.idx = 0; save(); show(h("h1", {}, "Teşekkürler"), h("p", {}, "Aynı bağlantıyla ikinci oturuma devam edebilirsiniz.")); } }, "Sonra devam ederim")),
      );
    } else {
      go("finish");
    }
  }

  function screenFinish() {
    if (!state.finished) { state.finished = true; logEvent("finish", {}); }
    const render = () => {
      const left = unsent();
      const waiting = cfg.endpoint && (flushing || left > 0) && retryCount < 20;
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(state.events, null, 1)], { type: "application/json" }));
      const backup = h("p", {}, h("a", { href: blobUrl, download: `yanitlar-${code}.json` }, "Yanıtlarımı indir (JSON, yedek)"));
      show(
        h("h1", {}, "Bitti, çok teşekkürler!"),
        h("p", {}, "Katkınız için teşekkür ederiz."),
        cfg.endpoint && left === 0 ? h("p", { class: "muted" }, `Tüm yanıtlarınız gönderildi (${state.events.length} kayıt). Sayfayı kapatabilirsiniz.`) : null,
        waiting ? h("p", { class: "muted" }, `Yanıtlarınız gönderiliyor (${left} kayıt kaldı); lütfen bu sayfayı kapatmayın.`) : null,
        left > 0 && !waiting ? h("div", { class: "notice" },
          h("p", {}, cfg.endpoint ? `${left} kayıt gönderilemedi. İnternet bağlantınızı kontrol edip bu sayfayı yeniden açın; olmazsa aşağıdaki dosyayı bağlantıyı size gönderen kişiye iletin.` : "Yanıtlarınız bu cihazda saklandı. Aşağıdaki dosyayı bağlantıyı size gönderen kişiye iletin."),
          backup) : null,
        left === 0 ? h("details", {}, h("summary", { class: "muted" }, "Yedek"), backup) : null,
      );
    };
    onFlushed = render;
    render();
    flush();
  }

  // ---------- açılış ----------
  async function boot() {
    try {
      try { cfg = await getJSON("config.json"); } catch { cfg = await getJSON("config.example.json"); }
      design = await getJSON(cfg.trials_url);
    } catch (e) {
      return show(h("p", { class: "notice err" }, "Test dosyaları yüklenemedi: " + e.message));
    }
    const c = qs.get("p");
    if (c && design.listeners[c]) {
      const old = store.get(`bws:${cfg.study_id}:${c}`);
      if (old) { code = c; plan = design.listeners[c]; state = JSON.parse(old); return route(); }
    }
    screenWelcome();
  }
  boot();
})();
