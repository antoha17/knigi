/* Страница «Статистика» — только для владельца.
   Ссылка на неё видна только владельцу, а все данные сервер отдаёт только ему (функции admin_* в базе).
   Файл одинаковый в обоих приложениях. Сейчас: места, ссылки-приглашения, люди.
   На шаге 3 сюда добавятся затраты на ИИ, лимиты и выбор модели. */
"use strict";

const Admin = (() => {
  const APPS = [["kino", "Что посмотреть"], ["knigi", "Что почитать"]];
  let data = null;
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
    catch(e){ $("#admin").innerHTML = head() + `<div class="status">Не удалось загрузить. Проверьте интернет и попробуйте ещё раз.</div>`; bindHead(); }
  }

  const head = () => `<div class="adm-head"><button id="admBack" aria-label="Назад">${IC("chev",2)}</button><h2>Статистика</h2></div>`;
  function bindHead(){ $("#admBack").onclick = close; }

  function render(){
    const free = Math.max(0, data.seats - data.used);
    const people = data.people.map(p => `
      <div class="adm-person ${p.disabled ? "off" : ""}">
        <div class="adm-pt">
          <b>${esc(p.email || "")}</b>${p.is_owner ? ` <span class="adm-badge">это вы</span>` : ""}${p.disabled ? ` <span class="adm-badge off">отключён</span>` : ""}
          <div>${since(p.created_at)} · ${p.last_seen ? "заходил " + when(p.last_seen) : "ещё не заходил"}</div>
          <div>в списках: фильмов ${p.kino}, книг ${p.knigi}</div>
        </div>
        ${p.is_owner ? "" : `<div class="adm-pa">
          <button data-act="${p.disabled ? "on" : "off"}" data-id="${p.id}" data-email="${esc(p.email || "")}">${p.disabled ? "Включить" : "Отключить"}</button>
          <button class="danger" data-act="del" data-id="${p.id}" data-email="${esc(p.email || "")}">Удалить</button>
        </div>`}
      </div>`).join("");
    const canShare = !!navigator.share;
    $("#admin").innerHTML = head() + `
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
        <h3>Люди <small>${data.people.length}</small></h3>
        ${people}
      </div>
      <p class="adm-note adm-soon">Скоро здесь появятся затраты на ИИ по каждому человеку, лимиты и выбор модели.</p>`;
    bindHead();
    $("#seatMinus").onclick = () => setSeats(data.seats - 1);
    $("#seatPlus").onclick = () => setSeats(data.seats + 1);
    $("#newInvite").onclick = newInvite;
    $("#admin").querySelectorAll("[data-share]").forEach(b => b.onclick = () => share(b.dataset.share, b));
    $("#admin").querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.id, b.dataset.email));
  }

  async function setSeats(n){
    if(n < 0) return;
    try{ await call("admin_set_seats", {n}); data.seats = n; render(); }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }
  async function newInvite(){
    if(!confirm("Сделать новую ссылку? Старая перестанет пускать новых людей.")) return;
    try{ data.invite = await call("admin_new_invite"); render(); toast("Готово, новая ссылка"); }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }
  async function share(app, btn){
    const url = link(app), name = APPS.find(a => a[0] === app)[1];
    if(navigator.share){
      try{ await navigator.share({title: name, text: `Приложение «${name}»: создай аккаунт по этой ссылке`, url}); }catch(e){}
      return;
    }
    try{ await navigator.clipboard.writeText(url); }
    catch(e){ const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); try{ document.execCommand("copy"); }catch(_){} t.remove(); }
    btn.textContent = "Скопировано"; setTimeout(() => { btn.textContent = "Скопировать"; }, 1500);
  }
  async function act(kind, id, email){
    try{
      if(kind === "del"){
        if(!confirm(`Удалить ${email}? Аккаунт и его списки удалятся навсегда, место освободится.`)) return;
        await call("admin_delete_user", {uid: id}); toast("Удалён");
      } else {
        if(kind === "off" && !confirm(`Отключить ${email}? Он не сможет пользоваться приложением, пока вы его не включите.`)) return;
        await call("admin_set_disabled", {uid: id, val: kind === "off"}); toast(kind === "off" ? "Отключён" : "Включён");
      }
      await load();
    }catch(e){ toast("Не получилось, попробуйте ещё раз"); }
  }

  function open(){
    document.body.classList.add("admin-open");
    $("#admin").innerHTML = head() + `<div class="status"><span class="dots">Загружаю</span></div>`;
    bindHead(); window.scrollTo({top: 0}); load();
  }
  function close(){ document.body.classList.remove("admin-open"); $("#admin").innerHTML = ""; window.scrollTo({top: 0}); }

  return {open, close};
})();
window.Admin = Admin;
$("#adminLink").onclick = () => Admin.open();
