/* Раздел «Статистика» в «Моём списке» — только для владельца.
   Ссылка на неё видна только владельцу, а все данные сервер отдаёт только ему (функции admin_* в базе).
   Файл одинаковый в обоих приложениях. Сейчас: места, ссылки-приглашения, люди.
   На шаге 3 сюда добавятся затраты на ИИ, лимиты и выбор модели. */
"use strict";

const Admin = (() => {
  const APPS = [["kino", "Что посмотреть"], ["knigi", "Что почитать"]];
  let data = null;
  // Модели, которые можно выбрать (цены известны серверу). [id, название, подсказка]
  const MODELS = [["gpt-6.2-sol", "gpt-6.2-sol", "точнее"], ["gpt-6.1-terra", "gpt-6.1-terra", "дешевле"]];
  const usd = v => "$" + (Number(v) || 0).toFixed(2).replace(".", ",");
  const sb = () => Sync.client();

  function link(app){
    // Оба приложения лежат рядом: …/kino/ и …/knigi/
    const base = location.pathname.replace(/\/(kino|knigi)\/.*$/, "/");
    return location.origin + base + app + "/?invite=" + encodeURIComponent(data.invite);
  }
  function when(ts){
    if(!ts) return "";
    const d = new Date(ts), now = new Date();
    const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 864e5);
    const t = d.toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"});
    if(diff === 0) return "сегодня " + t;
    if(diff === 1) return "вчера " + t;
    return d.toLocaleDateString("ru-RU", {day: "numeric", month: "short"});
  }
  const since = ts => "с " + new Date(ts).toLocaleDateString("ru-RU", {day: "numeric", month: "short"});

  async function call(fn, args){
    const {data: d, error} = await sb().rpc(fn, args || {});
    if(error) throw error;
    return d;
  }
  async function load(){
    try{ data = await call("admin_overview"); render(); }
    catch(e){ $("#admin").innerHTML = `<div class="status">Не удалось загрузить. Проверьте интернет и попробуйте ещё раз.</div>`; }
  }


  function render(){
    const free = Math.max(0, data.seats - data.used);
    const people = data.people.map(p => `
      <div class="adm-person ${p.disabled ? "off" : ""}">
        <div class="adm-pt">
          <b>${esc(p.email || "")}</b>${p.is_owner ? ` <span class="adm-badge">это вы</span>` : ""}${p.disabled ? ` <span class="adm-badge off">отключён</span>` : ""}
          <div>${since(p.created_at)} · ${p.last_seen ? "заходил " + when(p.last_seen) : "ещё не заходил"}</div>
          <div>записей: кино&nbsp;${p.kino} · книги&nbsp;${p.knigi}</div>
          <div>подборов: сегодня&nbsp;${p.picks_today ?? 0} · за&nbsp;месяц&nbsp;${p.picks_month ?? 0} · ${usd(p.cost_month)}</div>
          <div>лимит: ${p.unlimited ? "без лимита" : `${p.daily_limit ?? data.daily_limit}&nbsp;в&nbsp;день · ${usd(p.monthly_usd ?? data.monthly_usd)}&nbsp;в&nbsp;месяц`}</div>
        </div>
        ${p.is_owner ? "" : `<div class="adm-pa">
          <button data-act="lim" data-id="${p.id}" data-email="${esc(p.email || "")}">Лимиты</button>
          <button data-act="${p.disabled ? "on" : "off"}" data-id="${p.id}" data-email="${esc(p.email || "")}">${p.disabled ? "Включить" : "Отключить"}</button>
          <button class="danger" data-act="del" data-id="${p.id}" data-email="${esc(p.email || "")}">Удалить</button>
        </div>`}
      </div>`).join("");
    const canShare = !!navigator.share;
    $("#admin").innerHTML = `
      ${balanceCard()}
      <div class="adm-card">
        <h3>ИИ</h3>
        <div class="adm-spend"><b>${usd(data.month_total)}</b><span>потрачено в этом месяце из ${usd(data.global_monthly_usd)}</span>${(() => { const ppl = data.people.reduce((t, p) => t + Number(p.cost_month || 0), 0), nw = Math.max(0, Number(data.month_total) - ppl); return `<span style="display:block;margin-top:4px">подборы людей ${usd(ppl)} · новинки недели ${usd(nw)}</span>`; })()}</div>
        <div class="bar"><i style="width:${Math.min(100, data.global_monthly_usd > 0 ? 100 * data.month_total / data.global_monthly_usd : 0)}%"></i></div>
        <div class="label">Модель для всех</div>
        <div class="chips" id="aiModel">${MODELS.map(([m, n, h]) => `<button class="chip ${m === data.ai_model ? "on" : ""}" data-m="${m}">${n}<small>${h}</small></button>`).join("")}</div>
        <button class="btn ghost adm-wide" id="aiTest">Проверить модель</button>
        <p class="adm-note" id="aiTestRes"></p>
        <div class="label">Лимиты по умолчанию</div>
        <div class="adm-lims">
          <label>Подборов в день<input id="limDaily" type="number" inputmode="numeric" min="0" value="${data.daily_limit}"></label>
          <label>$ в месяц на человека<input id="limMonthly" type="number" inputmode="decimal" min="0" step="0.5" value="${Number(data.monthly_usd)}"></label>
          <label>$ в месяц на всех<input id="limGlobal" type="number" inputmode="decimal" min="0" step="1" value="${Number(data.global_monthly_usd)}"></label>
        </div>
        <button class="btn ghost adm-wide" id="aiSave">Сохранить</button>
        <p class="adm-note">На вас лимиты не действуют. Личные лимиты человека — кнопка «Лимиты» у него в списке ниже.</p>
      </div>
      <div class="adm-card">
        <h3>Места</h3>
        <div class="adm-seats">
          <div><b>${data.used} из ${data.seats}</b><span>${free ? `свободно ${free}` : "свободных мест нет"}</span></div>
          <div class="adm-step"><button id="seatMinus" aria-label="Меньше мест">−</button><button id="seatPlus" aria-label="Больше мест">+</button></div>
        </div>
        <p class="adm-note">Вы не занимаете место. Один аккаунт работает в обоих приложениях.</p>
      </div>
      <div class="adm-card">
        <h3>Ссылка-приглашение</h3>
        <p class="adm-note">Отправьте ссылку другу: он откроет её и создаст аккаунт. Без ссылки зарегистрироваться нельзя.</p>
        ${APPS.map(([a, n]) => `<div class="adm-link"><div><b>${n}</b><span>${esc(link(a).replace(/^https?:\/\//, ""))}</span></div><button data-share="${a}">${canShare ? "Отправить" : "Скопировать"}</button></div>`).join("")}
        <button class="btn ghost adm-wide" id="newInvite">Новая ссылка</button>
        <p class="adm-note">Если ссылка ушла не туда, нажмите «Новая ссылка»: старая перестанет пускать новых людей. Кто уже зарегистрирован, пользуется как раньше.</p>
      </div>
      <div class="adm-card">
        <h3>Связь с автором</h3>
        <p class="adm-note">Ссылки для строки «Автор» внизу «Моего списка». Кнопка видна, только если ссылка задана.</p>
        <input id="contactUrl" type="url" inputmode="url" autocomplete="off" placeholder="Telegram: https://t.me/ваш_ник" value="${esc(data.contact_url || "")}">
        <div class="label">Поблагодарить: перевод по СБП</div>
        <input id="sbpPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="Номер телефона, +7 …" value="${esc(data.sbp_phone ? "+" + data.sbp_phone : "")}">
        <input id="sbpBank" autocomplete="off" placeholder="Банк, например Т-Банк" value="${esc(data.sbp_bank || "")}" style="margin-top:8px">
        <div class="label">или ссылка на страницу оплаты</div>
        <input id="thanksUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://pay.cloudtips.ru/p/…" value="${esc(data.thanks_url || "")}">
        <p class="adm-note">Номер виден только вошедшим людям, в открытом коде его нет. Если указана ссылка, кнопка открывает её вместо СБП.</p>
        <button class="btn ghost adm-wide" id="thanksSave">Сохранить</button>
      </div>
      <div class="adm-card">
        <h3>Люди <small>${data.people.length}</small></h3>
        ${people}
      </div>
      <div class="adm-card">
        <h3>${APP === "kino" ? "Новинки и копия" : "Резервная копия"}</h3>
        <p class="adm-note" id="svcInfo">${APP === "kino" ? "Новинки недели обновляются сами каждую пятницу утром, р" : "Р"}езервная копия делается каждое воскресенье.</p>
        ${APP === "kino" ? `<button class="btn ghost adm-wide" id="newsNow">Обновить новинки сейчас</button>` : ""}
        <button class="btn ghost adm-wide" id="exportNow">Скачать резервную копию</button>
      </div>
      <div class="adm-card">
        <h3>Проверка</h3>
        <p class="adm-note">Показать анкету «Мой вкус», как её видят новые люди. Ваш вкус заменится, только если в конце нажать «Всё верно».</p>
        <button class="btn ghost adm-wide" id="onbAgain">Пройти анкету заново</button>
      </div>`;
    foldCards();
    // данные пришли — теперь страница достаточно длинная, поднимаем раздел к верху
    if(wantScroll){ wantScroll = false; const d = $("#adminLink");
      requestAnimationFrame(() => window.scrollTo({top: d.getBoundingClientRect().top + window.scrollY - 6, behavior: "smooth"})); }
    $("#seatMinus").onclick = () => setSeats(data.seats - 1);
    $("#seatPlus").onclick = () => setSeats(data.seats + 1);
    $("#newInvite").onclick = newInvite;
    $("#thanksSave").onclick = saveThanks;
    $("#aiModel").onclick = e => { const c = e.target.closest("[data-m]"); if(!c) return; $("#aiModel").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c)); };
    $("#aiSave").onclick = saveAi;
    $("#balSave").onclick = saveBalance;
    if($("#newsNow")) $("#newsNow").onclick = newsNow;
    $("#exportNow").onclick = exportNow;
    call("admin_backups").then(b => {
      const f = ts => ts ? new Date(ts).toLocaleDateString("ru-RU", {day: "numeric", month: "long"}) : "ещё не было";
      const el = $("#svcInfo"); if(el && b) el.textContent = (APP === "kino" ? `Новинки обновляются каждую пятницу (последние: ${f(b.news_last)}). ` : "") + `Резервная копия каждое воскресенье, хранятся последние 8 (последняя: ${f(b.last)}).`;
    }).catch(() => {});
    $("#onbAgain").onclick = () => { if(window.Taste) Taste.showQuestions(); };
    $("#aiTest").onclick = testModel;
    $("#admin").querySelectorAll("[data-share]").forEach(b => b.onclick = () => share(b.dataset.share, b));
    $("#admin").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.id, b.dataset.email));
  }

  async function setSeats(n){
    if(n < 0) return;
    try{ await call("admin_set_seats", {n}); data.seats = n; render(); }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }
  // Примерный баланс OpenAI: сумма, вписанная после пополнения, минус траты после этого.
  function balanceCard(){
    const left = data.balance_left == null ? null : Number(data.balance_left);
    const warn = Number(data.balance_warn ?? 1);
    const low = left !== null && left < warn;
    const since = data.balance_set_at ? new Date(data.balance_set_at).toLocaleDateString("ru-RU", {day: "numeric", month: "long"}) : "";
    return `<div class="adm-card ${low ? "adm-low" : ""}">
      <h3>Баланс OpenAI</h3>
      ${left === null
        ? `<p class="adm-note">Впишите сумму с platform.openai.com → Billing, и здесь будет видно, сколько примерно осталось.</p>`
        : `<div class="adm-spend"><b>≈ ${usd(left)}</b><span>было ${usd(data.balance_usd)} на ${since}, минус траты приложений</span></div>
           ${low ? `<div class="adm-alert">Пора пополнить баланс OpenAI</div>` : ""}`}
      <div class="adm-lims" style="margin-top:12px">
        <label>Баланс сейчас, $<input id="balAmount" type="number" inputmode="decimal" min="0" step="0.01" placeholder="2.90"></label>
        <label>Предупредить, когда меньше, $<input id="balWarn" type="number" inputmode="decimal" min="0" step="0.5" value="${warn}"></label>
      </div>
      <button class="btn ghost adm-wide" id="balSave">Сохранить</button>
      <a class="adm-ext" href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">Открыть баланс в OpenAI</a>
      <p class="adm-note">Это примерный остаток: другие программы на том же ключе и сгорание кредитов он не видит. Иногда сверяйте с OpenAI.</p>
    </div>`;
  }
  // Каждый блок «Статистики» сворачивается; какие раскрыты — запоминаем на этом устройстве.
  function foldCards(){
    let open = [];
    try{ open = JSON.parse(localStorage.getItem("kk-adm-open") || "[]"); }catch(e){}
    const left = data.balance_left == null ? null : Number(data.balance_left);
    const low = left !== null && left < Number(data.balance_warn ?? 1);
    const links = [data.contact_url && "Telegram", data.sbp_phone && "СБП", data.thanks_url && "ссылка"].filter(Boolean);
    const sum = {
      "Баланс OpenAI": left === null ? "не задан" : `≈ ${usd(left)}`,
      "ИИ": `${data.ai_model} · ${usd(data.month_total)}`,
      "Места": `${data.used} из ${data.seats}`,
      "Связь с автором": links.length ? links.join(", ") : "не задано",
    };
    $("#admin").querySelectorAll(".adm-card").forEach(card => {
      const h = card.querySelector("h3"); if(!h) return;
      const key = h.childNodes[0].textContent.trim();
      const d = document.createElement("details");
      d.className = card.className + " adm-fold";
      if(open.includes(key) || (key === "Баланс OpenAI" && low)) d.open = true;
      const sm = document.createElement("summary");
      sm.appendChild(h);
      sm.insertAdjacentHTML("beforeend", `<span class="adm-sum">${esc(sum[key] || "")}</span>${ARR}`);
      const body = document.createElement("div"); body.className = "adm-body";
      while(card.firstChild) body.appendChild(card.firstChild);
      d.append(sm, body);
      card.replaceWith(d);
      d.addEventListener("toggle", () => {
        let o = []; try{ o = JSON.parse(localStorage.getItem("kk-adm-open") || "[]"); }catch(e){}
        o = o.filter(x => x !== key); if(d.open) o.push(key);
        try{ localStorage.setItem("kk-adm-open", JSON.stringify(o)); }catch(e){}
      });
    });
  }
  async function saveBalance(){
    const raw = $("#balAmount").value.trim().replace(",", "."), warn = parseFloat($("#balWarn").value.replace(",", "."));
    const amount = raw === "" ? (data.balance_usd == null ? null : Number(data.balance_usd)) : parseFloat(raw);
    if((amount !== null && !(amount >= 0)) || !(warn >= 0)){ toast("Проверьте цифры"); return; }
    try{ await call("admin_set_balance", {amount, warn}); toast("Сохранил"); await load(); }
    catch(e){ toast("Не получилось сохранить"); }
  }
  const chosenModel = () => { const c = $("#aiModel .chip.on"); return c ? c.dataset.m : data.ai_model; };
  async function saveAi(){
    const daily = parseInt($("#limDaily").value, 10), monthly = parseFloat($("#limMonthly").value), global = parseFloat($("#limGlobal").value);
    if(!(daily >= 0) || !(monthly >= 0) || !(global >= 0)){ toast("Проверьте цифры лимитов"); return; }
    try{ await call("admin_set_ai", {model: chosenModel(), daily, monthly, global}); toast("Сохранил"); await load(); }
    catch(e){ toast("Не получилось сохранить"); }
  }
  async function testModel(){
    const m = chosenModel(), out = $("#aiTestRes"), btn = $("#aiTest");
    btn.disabled = true; out.textContent = "Спрашиваю " + m + "…";
    const t0 = Date.now();
    try{
      const r = await AI._post({prompt: "Ответь одним словом по-русски: работает?", kind: "test", model: m, stream: false});
      const j = await r.json();
      out.textContent = `Работает: ${m} ответила «${String(j.text || "").trim().slice(0, 40)}» за ${((Date.now() - t0) / 1000).toFixed(1).replace(".", ",")} с`;
    }catch(e){
      out.textContent = "Не работает: " + aiError(e) + (e && e.code ? ` (${e.code})` : "");
    }finally{ btn.disabled = false; }
  }
  async function personLimits(id, email){
    const p = data.people.find(x => x.id === id); if(!p) return false;
    const unlim = confirm(`${email}: без лимитов?\n\nОК — без лимитов, Отмена — задать лимиты.`);
    if(unlim){ await call("admin_set_person_limits", {uid: id, daily: null, monthly: null, unlim: true}); return true; }
    const d = prompt(`Подборов в день для ${email}\n(пусто — как у всех: ${data.daily_limit})`, p.daily_limit ?? "");
    if(d === null) return false;
    const m = prompt(`$ в месяц для ${email}\n(пусто — как у всех: ${Number(data.monthly_usd)})`, p.monthly_usd ?? "");
    if(m === null) return false;
    const dn = d.trim() === "" ? null : parseInt(d, 10), mn = m.trim() === "" ? null : parseFloat(m.replace(",", "."));
    if((dn !== null && !(dn >= 0)) || (mn !== null && !(mn >= 0))){ toast("Проверьте цифры"); return false; }
    await call("admin_set_person_limits", {uid: id, daily: dn, monthly: mn, unlim: false});
    return true;
  }
  async function newsNow(){
    const btn = $("#newsNow"), set = t => { btn.textContent = t; };
    btn.disabled = true; set("Ищу новинки в интернете…");
    const t0 = Date.now();
    try{
      const r = await fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/news", {method: "POST",
        headers: {"Content-Type": "application/json", apikey: CFG.supabaseAnonKey, Authorization: "Bearer " + Sync.token()}, body: "{}"});
      const j = await r.json().catch(() => ({}));
      if(!r.ok) throw {code: j.code || ("HTTP " + r.status)};
      // поиск идёт на сервере в фоне — ждём итог (до 3 минут)
      for(let i = 0; i < 36; i++){
        await new Promise(res => setTimeout(res, 5000));
        set(`Ищу новинки… ${Math.round((Date.now() - t0) / 1000)} с`);
        const {data: st} = await sb().rpc("public_news", {a: "status"});
        if(st && new Date(st.created_at).getTime() > t0 - 5000){
          if(/^готово/.test(st.week)){ toast("Новинки обновлены"); if(window.onLogin) window.onLogin(sb()); }
          else alert("Новинки не обновились:\n" + st.week);
          return;
        }
      }
      toast("Долго нет ответа. Загляните позже: новинки появятся сами");
    }catch(e){ toast("Не получилось" + (e && e.code ? ` (${e.code})` : "")); }
    finally{ btn.disabled = false; set("Обновить новинки сейчас"); }
  }
  async function exportNow(){
    try{
      const d = await call("admin_export");
      const blob = new Blob([JSON.stringify(d, null, 1)], {type: "application/json"});
      const name = "kino-knigi-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      const file = new File([blob], name, {type: "application/json"});
      if(navigator.canShare && navigator.canShare({files: [file]})){ await navigator.share({files: [file], title: name}); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }catch(e){ if(!(e && e.name === "AbortError")) toast("Не получилось скачать"); }
  }
  async function saveThanks(){
    const c = $("#contactUrl").value.trim(), t = $("#thanksUrl").value.trim();
    const bad = u => u && !/^https:\/\/\S+$/i.test(u);
    if(bad(c) || bad(t)){ toast("Ссылка должна начинаться с https://"); return; }
    try{
      await call("admin_set_contact", {url: c});
      await call("admin_set_thanks", {url: t});
      const ph = $("#sbpPhone").value.trim(), bank = $("#sbpBank").value.trim();
      try{ await call("admin_set_sbp", {phone: ph, bank}); }
      catch(e){ toast("Проверьте номер: нужно 11 цифр, например +7 912 345-67-89"); return; }
      await load();
      Sync.setLinks({contact_url: data.contact_url, thanks_url: data.thanks_url, sbp_phone: data.sbp_phone, sbp_bank: data.sbp_bank});
      toast("Сохранил");
    }catch(e){ toast("Не получилось сохранить. Проверьте ссылки"); }
  }
  async function newInvite(){
    if(!confirm("Сделать новую ссылку? Старая перестанет пускать новых людей.")) return;
    try{ data.invite = await call("admin_new_invite"); render(); toast("Готово, новая ссылка"); }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }
  async function share(app, btn){
    const url = link(app), name = APPS.find(a => a[0] === app)[1];
    // Текст и ссылка одной строкой: если передать ссылку отдельно, Telegram отправляет только её, без текста.
    const msg = `Приложение «${name}»: создай аккаунт по этой ссылке ${url}`;
    if(navigator.share){
      try{ await navigator.share({text: msg}); }catch(e){}
      return;
    }
    try{ await navigator.clipboard.writeText(msg); }
    catch(e){ const t = document.createElement("textarea"); t.value = msg; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); }catch(_){} t.remove(); }
    btn.textContent = "Скопировано"; setTimeout(() => { btn.textContent = "Скопировать"; }, 1500);
  }
  async function act(kind, id, email){
    try{
      if(kind === "lim"){ if(!(await personLimits(id, email))) return; toast("Сохранил"); }
      else if(kind === "del"){
        if(!confirm(`Удалить ${email}? Аккаунт и его списки удалятся навсегда, место освободится.`)) return;
        await call("admin_delete_user", {uid: id}); toast("Удалён");
      } else if(kind === "on" || kind === "off"){
        if(kind === "off" && !confirm(`Отключить ${email}? Он не сможет пользоваться приложением, пока вы его не включите.`)) return;
        await call("admin_set_disabled", {uid: id, val: kind === "off"}); toast(kind === "off" ? "Отключён" : "Включён");
      }
      await load();
    }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }

  // Данные загружаются заново при каждом раскрытии раздела.
  let wantScroll = false;
  function open(){
    wantScroll = true;
    $("#admin").innerHTML = `<div class="status"><span class="dots">Загружаю</span></div>`;
    load();
  }
  function close(){ const box = $("#adminLink"); if(box) box.open = false; $("#admin").innerHTML = ""; }

  return {open, close};
})();
window.Admin = Admin;
$("#adminLink").addEventListener("toggle", e => { if(e.target.open) Admin.open(); });
