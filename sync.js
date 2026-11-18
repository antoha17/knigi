/* Вход по почте (код из письма) и синхронизация списка с Supabase.
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
    if(!diff(fresh).empty) schedule(); else setStatus("ok");
  }

  /* ---------- вход ---------- */
  function errText(e){
    const m = String((e && (e.code || e.message)) || "").toLowerCase();
    if(m.includes("rate") || (e && e.status===429)) return "Слишком много писем подряд. Подождите немного и попробуйте снова";
    if(m.includes("otp") || m.includes("token") || m.includes("expired") || m.includes("invalid")) return "Код не подошёл или устарел. Запросите новый";
    if(m.includes("email")) return "Проверьте адрес почты";
    if(!navigator.onLine || m.includes("fetch")) return "Нет связи. Проверьте интернет";
    return "Не получилось. Попробуйте ещё раз";
  }

  function showLogin(step, email){
    step = step || "email";
    const box = $("#sheet");
    box.innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lgTitle">
      <h3 id="lgTitle">${step==="email" ? "Вход" : "Введите код из письма"}</h3>
      ${step==="email"
        ? `<p>Список будет храниться на сервере и будет одинаковым на телефоне и компьютере. Пароль не нужен: пришлём код на почту.</p>
           <input id="lgEmail" type="email" inputmode="email" autocomplete="email" placeholder="Ваша почта" style="margin-top:14px" value="${esc(email||"")}">
           <div class="btns"><button class="btn main" id="lgGo">Получить код</button></div>`
        : `<p>Отправили письмо на <b>${esc(email)}</b>. Если его нет, загляните в «Спам».</p>
           <input id="lgCode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Код из письма" style="margin-top:14px;letter-spacing:4px;font-size:20px;text-align:center">
           <div class="btns"><button class="btn main" id="lgGo">Войти</button></div>
           <div class="btns" style="margin-top:8px"><button class="btn ghost" style="flex:1;font-size:14px" id="lgBack">Другая почта</button><button class="btn ghost" style="flex:1;font-size:14px" id="lgResend">Отправить ещё раз</button></div>`}
      <p class="lg-err" id="lgErr" style="color:var(--bad)"></p>
      <div class="btns" style="margin-top:6px"><button class="btn ghost" style="flex:1" id="lgClose">Отмена</button></div>
    </div></div>`;
    const close = () => { box.innerHTML = ""; };
    $(".sheet-bg").onclick = e => { if(e.target.classList.contains("sheet-bg")) close(); };
    $("#lgClose").onclick = close;
    const err = t => { $("#lgErr").textContent = t || ""; };
    const go = $("#lgGo");
    const busy = (b, t) => { go.disabled = b; go.textContent = t; };

    async function sendCode(addr){
      const {error} = await sb.auth.signInWithOtp({email: addr, options: {shouldCreateUser: true}});
      if(error) throw error;
    }
    if(step === "email"){
      const inp = $("#lgEmail"); setTimeout(() => inp.focus(), 50);
      const submit = async () => {
        const addr = inp.value.trim().toLowerCase();
        if(!/^\S+@\S+\.\S+$/.test(addr)){ err("Проверьте адрес почты"); return; }
        busy(true, "Отправляю…"); err("");
        try{ await sendCode(addr); showLogin("code", addr); }
        catch(e){ busy(false, "Получить код"); err(errText(e)); }
      };
      go.onclick = submit; inp.onkeydown = e => { if(e.key==="Enter") submit(); };
    } else {
      const inp = $("#lgCode"); setTimeout(() => inp.focus(), 50);
      const submit = async () => {
        const code = inp.value.replace(/\D/g, "");
        if(code.length < 6){ err("Введите код из письма полностью"); return; }
        busy(true, "Проверяю…"); err("");
        try{
          const {error} = await sb.auth.verifyOtp({email, token: code, type: "email"});
          if(error) throw error;
          close(); toast("Готово, вы вошли");
        }catch(e){ busy(false, "Войти"); err(errText(e)); }
      };
      go.onclick = submit; inp.onkeydown = e => { if(e.key==="Enter") submit(); };
      $("#lgBack").onclick = () => showLogin("email", email);
      $("#lgResend").onclick = async () => {
        err(""); try{ await sendCode(email); toast("Отправили новый код"); }catch(e){ err(errText(e)); }
      };
    }
  }

  async function logout(){
    if(!confirm("Выйти? Список останется на сервере, на этом устройстве он скроется до следующего входа.")) return;
    await flush();
    try{ await sb.auth.signOut(); }catch(e){}
  }

  /* ---------- блок «аккаунт» ---------- */
  function renderAccount(){
    const box = $("#account"); if(!box) return;
    if(!ready()){ box.innerHTML = ""; return; }
    if(!user()){
      box.innerHTML = `<div class="acc-card"><div>Войдите, чтобы список не потерялся и был одинаковым на телефоне и компьютере.</div><button class="btn main" id="accLogin">Войти по почте</button></div>`;
      $("#accLogin").onclick = () => showLogin();
    } else {
      const st = {saving:"Сохраняю…", offline:"Нет сети, сохраню позже", error:"Не удалось сохранить, повторю позже", ok:"Всё сохранено"}[status] || "";
      box.innerHTML = `<div class="acc-line"><span>${IC("check")}${esc(user().email||"")}${st?` · <i>${st}</i>`:""}</span><button id="accOut">Выйти</button></div>`;
      $("#accOut").onclick = logout;
    }
  }

  /* ---------- запуск ---------- */
  function init(){
    if(!ready()){ renderAccount(); return; }
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "kk-auth"}
    });
    sb.auth.onAuthStateChange((event, s) => {
      const was = user() && user().id;
      session = s;
      if(event === "SIGNED_OUT"){
        try{ localStorage.removeItem(SNAP); }catch(e){}
        state.items = []; state.profile = "";
        try{ localStorage.removeItem(LS_KEY); }catch(e){}
        renderAll(); renderAccount(); return;
      }
      renderAccount();
      if(s && (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && was !== s.user.id))){
        setTimeout(() => pull().catch(() => setStatus("error")), 0);
      }
    });
    window.addEventListener("online", () => schedule());
    document.addEventListener("visibilitychange", () => {
      if(document.visibilityState === "visible"){ if(Date.now() - lastPull > 15000) pull().catch(()=>{}); }
      else flush();
    });
    renderAccount();
  }

  return {init, schedule, flush, pull, showLogin, token: () => session && session.access_token, user};
})();
window.Sync = Sync;
window.Auth = {token: () => Sync.token()};
Sync.init();
