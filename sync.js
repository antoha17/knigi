/* Вход по почте и паролю и синхронизация списка с Supabase.
   Файл одинаковый в обоих приложениях (kino и knigi). Ожидает из app.js:
   APP, LS_KEY, state, norm, esc, IC, toast, renderAll, renderResults, $.

   Как работает синхронизация:
   - сервер хранит каждую запись отдельной строкой (таблица items) и «Мой вкус» (таблица tastes);
   - «синхронизированный снимок» (что, по нашим данным, уже лежит на сервере) хранится в браузере;
   - при изменении сравниваем список со снимком и отправляем только разницу;
   - при открытии приложения берём свежие данные с сервера и накладываем сверху ещё не отправленные изменения.
   Без входа всё работает как раньше: список хранится только на этом устройстве. */
"use strict";

const Sync = (() => {
  const SNAP = LS_KEY + ".synced";          // снимок того, что уже на сервере
  // Код приглашения из ссылки вида …/kino/?invite=abc123: запоминаем и убираем из адресной строки.
  let invite = null;
  try{
    const u = new URL(location.href), c = u.searchParams.get("invite");
    if(c){ localStorage.setItem("kk-invite", c); u.searchParams.delete("invite"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
    invite = localStorage.getItem("kk-invite");
  }catch(e){}
  let disabled = false;
  let sb = null, session = null;
  let flushTimer = null, flushing = false, again = false, lastPull = 0, status = "";

  const ready = () => !!(window.supabase && CFG.supabaseUrl && CFG.supabaseAnonKey);
  const user = () => session && session.user;

  function loadSnap(){
    try{ const s = JSON.parse(localStorage.getItem(SNAP)||"null"); if(s && user() && s.uid===user().id) return s; }catch(e){}
    return {uid: user() ? user().id : null, items:{}, profile:null};
  }
  function saveSnap(s){ try{ localStorage.setItem(SNAP, JSON.stringify(s)); }catch(e){} }

  // Разница между текущим списком и снимком сервера.
  function diff(snap){
    const cur = {};
    for(const it of state.items){ const n = norm(it.title); if(n && !cur[n]) cur[n] = it; }
    const upserts = [], deletes = [];
    for(const n in cur){ const j = JSON.stringify(cur[n]); if(snap.items[n] !== j) upserts.push([n, cur[n], j]); }
    for(const n in snap.items){ if(!cur[n]) deletes.push(n); }
    const profileChanged = snap.profile !== state.profile;
    return {upserts, deletes, profileChanged, empty: !upserts.length && !deletes.length && !profileChanged};
  }

  function setStatus(s){ status = s; renderAccount(); }

  async function flush(){
    if(!sb || !user()) return;
    if(flushing){ again = true; return; }
    const snap = loadSnap();
    const d = diff(snap);
    if(d.empty){ setStatus("ok"); return; }
    if(!navigator.onLine){ setStatus("offline"); return; }
    flushing = true; setStatus("saving");
    try{
      const uid = user().id;
      if(d.upserts.length){
        const rows = d.upserts.map(([n, it]) => ({user_id: uid, app: APP, norm: n, data: it, updated_at: new Date().toISOString()}));
        const {error} = await sb.from("items").upsert(rows, {onConflict: "user_id,app,norm"});
        if(error) throw error;
        d.upserts.forEach(([n, , j]) => { snap.items[n] = j; });
      }
      if(d.deletes.length){
        const {error} = await sb.from("items").delete().eq("app", APP).in("norm", d.deletes);
        if(error) throw error;
        d.deletes.forEach(n => { delete snap.items[n]; });
      }
      if(d.profileChanged){
        const p = state.profile;
        const {error} = await sb.from("tastes").upsert({user_id: uid, app: APP, profile: p, updated_at: new Date().toISOString()}, {onConflict: "user_id,app"});
        if(error) throw error;
        snap.profile = p;
      }
      snap.uid = uid; saveSnap(snap);
      setStatus("ok");
    }catch(e){
      setStatus(navigator.onLine ? "error" : "offline");
    }finally{
      flushing = false;
      if(again){ again = false; schedule(); }
    }
  }
  function schedule(){ clearTimeout(flushTimer); flushTimer = setTimeout(flush, 700); }

  // Свежие данные с сервера + ещё не отправленные изменения с этого устройства.
  async function pull(){
    if(!sb || !user()) return;
    const snap = loadSnap();
    const local = diff(snap);
    const [it, ta] = await Promise.all([
      sb.from("items").select("norm,data").eq("app", APP),
      sb.from("tastes").select("profile").eq("app", APP).maybeSingle()
    ]);
    if(it.error || ta.error){ setStatus(navigator.onLine ? "error" : "offline"); return; }
    lastPull = Date.now();
    const server = {}, order = [];
    for(const r of it.data){ server[r.norm] = r.data; order.push(r.norm); }
    const fresh = {uid: user().id, items:{}, profile: ta.data ? ta.data.profile : ""};
    for(const n in server) fresh.items[n] = JSON.stringify(server[n]);
    // накладываем свои неотправленные изменения
    for(const [n, item] of local.upserts) server[n] = item;
    for(const n of local.deletes) delete server[n];
    // «Мой вкус»: при первой синхронизации на устройстве главнее серверный текст (если он есть),
    // дальше — если меняли здесь, то здешний.
    let profile;
    if(snap.profile === null) profile = fresh.profile || state.profile;
    else profile = local.profileChanged ? state.profile : fresh.profile;
    state.items = Object.values(server).sort((a, b) => (b.ts||0) - (a.ts||0));
    state.profile = profile || "";
    saveSnap(fresh);
    try{ localStorage.setItem(LS_KEY, JSON.stringify({profile: state.profile, items: state.items, updated: Date.now()})); }catch(e){}
    renderAll(); if(typeof renderResults === "function") renderResults();
    if(window.Taste) Taste.maybeStart();   // новый человек с пустым «Моим вкусом» — анкета
    if(!diff(fresh).empty) schedule(); else setStatus("ok");
  }

  /* ---------- вход по почте и паролю ---------- */
  // Открыто с рабочего стола (а не в браузере). На iPhone у такого приложения свои данные, приглашение из ссылки сюда не попадает.
  const fromDesk = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const NO_INVITE_DESK = "Нет аккаунта? Сначала откройте ссылку-приглашение в любом браузере на телефоне и зарегистрируйтесь там. Потом войдите здесь с той же почтой и паролем.";
  function errText(e){
    const m = ((e && e.code || "") + " " + (e && e.message || "")).toLowerCase();
    if(m.includes("invite_required")) return fromDesk() ? NO_INVITE_DESK : "Регистрация только по приглашению. Попросите новую ссылку у того, кто дал приложение";
    if(m.includes("no_seats")) return "Свободных мест нет. Напишите тому, кто дал вам ссылку";
    if(m.includes("invalid_credentials") || m.includes("invalid login")) return "Неверная почта или пароль";
    if(m.includes("already") || m.includes("user_exists")) return "Такая почта уже зарегистрирована. Нажмите «Войти»";
    if(m.includes("weak") || m.includes("password should") || m.includes("at least")) return "Пароль слишком простой: нужно не меньше 6 символов";
    if(m.includes("not_confirmed") || m.includes("not confirmed")) return "Почта не подтверждена. Напишите владельцу приложения";
    if(m.includes("rate") || (e && e.status===429)) return "Слишком много попыток. Подождите немного и попробуйте снова";
    if(m.includes("same_password") || m.includes("different from the old")) return "Новый пароль должен отличаться от старого";
    if(m.includes("email")) return "Проверьте адрес почты";
    if(!navigator.onLine || m.includes("fetch")) return "Нет связи. Проверьте интернет";
    return "Не получилось. Попробуйте ещё раз";
  }

  const TITLES = {login:"Вход", signup:"Регистрация", reset:"Восстановить пароль", newpass:"Новый пароль"};
  // inGate = true: форма прямо на главном экране (до входа), иначе — во всплывающем окне.
  function showLogin(mode, email, inGate){
    mode = mode || "login";
    const box = inGate ? $("#gate") : $("#sheet");
    const emailInp = `<input id="lgEmail" type="email" inputmode="email" autocomplete="username" placeholder="Почта" style="margin-top:14px" value="${esc(email||"")}">`;
    const passInp = (ac, ph) => `<input id="lgPass" type="password" autocomplete="${ac}" placeholder="${ph}" style="margin-top:8px">`;
    const body = {
      login: `<p>Войдите или создайте аккаунт. Список будет храниться на сервере и будет одинаковым на телефоне и компьютере.</p>${emailInp}${passInp("current-password","Пароль")}
        <div class="btns"><button class="btn main" id="lgGo">Войти</button></div>
        <div class="lg-links">${invite ? `<button id="lgToSignup">Создать аккаунт</button>` : `<span></span>`}<button id="lgToReset">Забыли пароль?</button></div>
        ${invite ? "" : `<p class="lg-note">${fromDesk() ? NO_INVITE_DESK : "Нет аккаунта? Попросите ссылку-приглашение у того, кто дал вам приложение."}</p>`}`,
      signup: `<p>Вас пригласили! Укажите почту и придумайте пароль: не меньше 6 символов. Один аккаунт подходит для обоих приложений: «Что посмотреть» и «Что почитать».</p>${emailInp}${passInp("new-password","Новый пароль")}
        <div class="btns"><button class="btn main" id="lgGo">Создать аккаунт</button></div>
        <div class="lg-links"><button id="lgToLogin">У меня уже есть аккаунт</button></div>`,
      reset: `<p>Пришлём письмо со ссылкой. Откройте её, задайте новый пароль, потом войдите с ним в приложении.</p>${emailInp}
        <div class="btns"><button class="btn main" id="lgGo">Прислать письмо</button></div>
        <div class="lg-links"><button id="lgToLogin">Назад ко входу</button></div>`,
      newpass: `<p>Придумайте новый пароль: не меньше 6 символов.</p>${passInp("new-password","Новый пароль")}
        <div class="btns"><button class="btn main" id="lgGo">Сохранить пароль</button></div>`
    }[mode];
    const err0 = `<p id="lgErr" class="lg-err"></p>`;
    if(inGate){
      box.innerHTML = `<div class="gate-card"><h3 id="lgTitle">${TITLES[mode]}</h3>${body.replace('<div class="btns">', err0+'<div class="btns">')}</div>`;
    } else {
      box.innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lgTitle">
        <h3 id="lgTitle">${TITLES[mode]}</h3>${body.replace('<div class="btns">', err0+'<div class="btns">')}
        <div class="btns" style="margin-top:6px"><button class="btn ghost" style="flex:1" id="lgClose">${mode==="newpass"?"Позже":"Отмена"}</button></div>
      </div></div>`;
      $(".sheet-bg").onclick = e => { if(e.target.classList.contains("sheet-bg")) close(); };
      $("#lgClose").onclick = () => close();
    }
    const close = () => { if(!inGate) box.innerHTML = ""; };
    const curEmail = () => ($("#lgEmail") ? $("#lgEmail").value.trim().toLowerCase() : email);
    [["#lgToSignup","signup"],["#lgToLogin","login"],["#lgToReset","reset"]].forEach(([id, m]) => { const b=$(id); if(b) b.onclick = () => showLogin(m, curEmail(), inGate); });
    const err = t => { $("#lgErr").textContent = t || ""; };
    const go = $("#lgGo"), label = go.textContent;
    const busy = b => { go.disabled = b; go.textContent = b ? "Минутку…" : label; };
    const first = $("#lgEmail") && !email ? $("#lgEmail") : ($("#lgPass") || $("#lgEmail"));
    if(!inGate || email) setTimeout(() => first && first.focus(), 50);

    const submit = async () => {
      const addr = curEmail(), pass = $("#lgPass") ? $("#lgPass").value : "";
      if(mode !== "newpass" && !/^\S+@\S+\.\S+$/.test(addr||"")){ err("Проверьте адрес почты"); return; }
      if((mode === "signup" || mode === "newpass") && pass.length < 6){ err("Пароль должен быть не короче 6 символов"); return; }
      if(mode === "login" && !pass){ err("Введите пароль"); return; }
      busy(true); err("");
      try{
        if(mode === "login"){
          const {error} = await sb.auth.signInWithPassword({email: addr, password: pass});
          if(error) throw error;
          close(); toast("Готово, вы вошли"); showTab("pick");
        } else if(mode === "signup"){
          const {data, error} = await sb.auth.signUp({email: addr, password: pass, options: {data: {invite: invite || ""}}});
          if(error) throw error;
          if(data && data.user && Array.isArray(data.user.identities) && !data.user.identities.length) throw {code:"user_exists"};
          try{ localStorage.removeItem("kk-invite"); }catch(e){} invite = null;
          if(!data.session){ busy(false); err("Аккаунт создан, но вход пока не разрешён. Напишите владельцу приложения"); return; }
          close(); toast("Аккаунт создан, вы вошли"); showTab("pick");
        } else if(mode === "reset"){
          const redirectTo = location.origin + location.pathname;
          const {error} = await sb.auth.resetPasswordForEmail(addr, {redirectTo});
          if(error) throw error;
          busy(false); err(""); go.textContent = "Письмо отправлено"; go.disabled = true;
          box.querySelector("p").textContent = "Письмо отправлено на " + addr + ". Откройте ссылку из него (если письма нет, загляните в «Спам»).";
        } else if(mode === "newpass"){
          const {error} = await sb.auth.updateUser({password: pass});
          if(error) throw error;
          close(); toast("Пароль сохранён");
        }
      }catch(e){ busy(false); err(errText(e)); }
    };
    go.onclick = submit;
    box.querySelectorAll("input").forEach(i => i.onkeydown = e => { if(e.key==="Enter") submit(); });
  }

  async function logout(){
    if(!confirm("Выйти? Список останется на сервере, на этом устройстве он скроется до следующего входа.")) return;
    await flush();
    try{ await sb.auth.signOut(); }catch(e){}
  }

  /* ---------- экран входа и строка «аккаунт» ---------- */
  // Пока человек не вошёл, вместо вкладок показываем экран входа.
  function applyGate(){
    document.body.classList.remove("auth-pending");
    const gated = ready() && (!user() || disabled);
    const was = document.body.classList.contains("gated");
    document.body.classList.toggle("gated", gated);
    if(disabled && user()) return showDisabled();
    if(gated && !was) showLogin(invite ? "signup" : "login", "", true);
    if(!gated) $("#gate").innerHTML = "";
  }
  function showDisabled(){
    document.body.classList.add("gated");
    $("#gate").innerHTML = `<div class="gate-card"><h3>Доступ отключён</h3><p>Владелец приложения отключил вам доступ. Если это ошибка, напишите ему.</p><div class="btns"><button class="btn ghost" style="flex:1" id="disOut">Выйти</button></div></div>`;
    $("#disOut").onclick = async () => { try{ await sb.auth.signOut(); }catch(e){} };
  }
  // Строка «Автор» внизу «Моего списка»: кнопки «Написать» и «Поблагодарить».
  // Каждая видна, только если владелец задал для неё ссылку; без ссылок строки нет.
  function setLinks(l){
    l = l || {};
    const good = u => typeof u === "string" && /^https:\/\/\S+$/i.test(u);
    const put = (id, u) => { const a = $(id); if(!a) return false; a.classList.toggle("hidden", !good(u)); if(good(u)) a.href = u; return good(u); };
    const c = put("#contactLink", l.contact_url);
    // «Поблагодарить»: ссылка на оплату, а если её нет — перевод по СБП (окно с номером).
    let t = put("#thanksLink", l.thanks_url);
    window.SBP = l.sbp_phone ? {phone: l.sbp_phone, bank: l.sbp_bank || ""} : null;
    const ta = $("#thanksLink");
    if(ta){ ta.dataset.sbp = !t && window.SBP ? "1" : ""; if(!t && window.SBP){ ta.classList.remove("hidden"); ta.href = "#"; t = true; } }
    const row = $("#authorRow"); if(row) row.classList.toggle("hidden", !c && !t);
    try{ (c || t) ? localStorage.setItem("kk-links", JSON.stringify({contact_url: l.contact_url || null, thanks_url: l.thanks_url || null, sbp_phone: l.sbp_phone || null, sbp_bank: l.sbp_bank || null})) : localStorage.removeItem("kk-links"); }catch(e){}
  }
  // Окно «Поблагодарить» переводом по СБП.
  function showSbp(){
    const x = window.SBP; if(!x) return;
    const d = x.phone, nice = `+${d[0]} ${d.slice(1,4)} ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}`;
    $("#sheet").innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sbpTitle">
      <h3 id="sbpTitle">Поблагодарить автора</h3>
      <p>Перевод по номеру телефона через СБП, без комиссии. Сумма любая.</p>
      <div class="sbp-num">${esc(nice)}</div>
      ${x.bank ? `<div class="sbp-bank">Банк получателя: ${esc(x.bank)}</div>` : ""}
      <div class="btns"><button class="btn main" id="sbpCopy">Скопировать номер</button></div>
      <ol><li><span>Откройте приложение своего банка.</span></li><li><span>Переводы → «По номеру телефона» (СБП).</span></li><li><span>Вставьте номер${x.bank ? `, выберите «${esc(x.bank)}»` : ""} и укажите сумму.</span></li></ol>
      <div class="btns"><button class="btn ghost" style="flex:1" id="sbpClose">Закрыть</button></div>
    </div></div>`;
    const close = () => { $("#sheet").innerHTML = ""; };
    $(".sheet-bg").onclick = e => { if(e.target.classList.contains("sheet-bg")) close(); };
    $("#sbpClose").onclick = close;
    $("#sbpCopy").onclick = async () => {
      const txt = "+" + d;
      try{ await navigator.clipboard.writeText(txt); }
      catch(e){ const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); }catch(_){} t.remove(); }
      $("#sbpCopy").textContent = "Номер скопирован";
    };
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("#thanksLink");
    if(a && a.dataset.sbp === "1"){ e.preventDefault(); showSbp(); }
  });
  // При каждом открытии: отмечаем «заходил», узнаём, не отключён ли доступ и не владелец ли это.
  async function afterLogin(){
    try{
      const {data} = await sb.rpc("touch");
      if(data === true){ disabled = true; applyGate(); return; }
      if(typeof window.onLogin === "function") window.onLogin(sb);
      const ps = await sb.rpc("public_settings");
      if(!ps.error) setLinks(ps.data);
      const o = await sb.rpc("is_owner");
      const own = o.data === true;
      try{ own ? localStorage.setItem("kk-owner", "1") : localStorage.removeItem("kk-owner"); }catch(e){}
      const link = $("#adminLink"); if(link) link.classList.toggle("hidden", !own);
    }catch(e){}
  }
  function renderAccount(){
    const box = $("#account"); if(!box) return;
    if(!ready() || !user()){ box.innerHTML = ""; return; }
    // Показываем только проблемы: «нет сети» или «не удалось сохранить».
    const st = {offline:"Нет сети, сохраню позже", error:"Не удалось сохранить, повторю позже"}[status] || "";
    box.innerHTML = `<div class="acc-line"><span>${IC("check")}${esc(user().email||"")}${st?` · <i>${st}</i>`:""}</span><button id="accOut">Выйти</button></div>`;
    $("#accOut").onclick = logout;
  }

  /* ---------- запуск ---------- */
  function init(){
    if(!ready()){ applyGate(); renderAccount(); return; }
    // Не ждём ответа сервера: если вход сохранён на устройстве — сразу показываем приложение,
    // если нет — сразу экран входа. Сервер потом только уточнит.
    let stored = false; try{ stored = !!localStorage.getItem("kk-auth"); }catch(e){}
    document.body.classList.toggle("gated", !stored);
    if(!stored) showLogin(invite ? "signup" : "login", "", true);
    // Ссылку «Статистика» показываем сразу, если раньше уже выяснили, что это владелец (сервер потом уточнит).
    try{ if(stored && localStorage.getItem("kk-owner") === "1") $("#adminLink").classList.remove("hidden"); }catch(e){}
    try{ if(stored) setLinks(JSON.parse(localStorage.getItem("kk-links") || "null")); }catch(e){}
    document.body.classList.remove("auth-pending");
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "kk-auth"}
    });
    sb.auth.onAuthStateChange((event, s) => {
      const was = user() && user().id;
      session = s;
      if(event === "PASSWORD_RECOVERY"){
        // открыли ссылку «восстановить пароль» из письма
        try{ history.replaceState(null, "", location.pathname); }catch(e){}
        setTimeout(() => showLogin("newpass"), 0);
      }
      if(event === "SIGNED_OUT"){
        disabled = false; const link = $("#adminLink"); if(link) link.classList.add("hidden");
        try{ localStorage.removeItem("kk-owner"); }catch(e){}
        setLinks(null);
        if(window.Admin) Admin.close();
        try{ localStorage.removeItem(SNAP); }catch(e){}
        state.items = []; state.profile = "";
        try{ localStorage.removeItem(LS_KEY); }catch(e){}
        renderAll(); renderAccount(); applyGate(); return;
      }
      renderAccount(); applyGate();
      if(s && (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && was !== s.user.id))){
        setTimeout(() => { afterLogin(); pull().catch(() => setStatus("error")); }, 0);
      }
    });
    window.addEventListener("online", () => schedule());
    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState === "visible"){ if(Date.now() - lastPull > 15000) pull().catch(()=>{}); }
      else flush();
    });
    renderAccount();
  }

  return {init, schedule, flush, pull, showLogin, setLinks, token: () => session && session.access_token, user, client: () => sb};
})();
window.Sync = Sync;
window.Auth = {token: () => Sync.token()};
Sync.init();
