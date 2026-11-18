/* «Что почитать» — логика приложения.
   Интерфейс и промпты перенесены из прототипа (артефакт Claude).
   Хранение: пока в браузере (localStorage); на шаге 2 добавится синхронизация через Supabase.
   ИИ: через серверную функцию Supabase `ai` (шаг 3); пока сервер не подключён — понятное сообщение. */
"use strict";

const APP = "knigi";
const CFG = window.APP_CONFIG || {};
const LS_KEY = "knigi.v1";

const state = { profile: "", items: [] };
let news = null;             // «Новинки недели» — придут с сервера
let shownThisVisit = [];     // что уже предлагали в этот раз
let current = [];            // текущие карточки подбора
let busy = false, picking = false, saveTimer = null;
const openGroups = new Set();

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = s => String(s||"").toLowerCase().replace(/ё/g,"е").replace(/[^a-zа-я0-9]/g,"");
const KIND = {fiction:"История", nonfiction:"Полезное"};
const kindOf = k => k==="nonfiction"?"nonfiction":"fiction";

/* ---------- иконки (единый контурный стиль) ---------- */
const P = {
  spark:'<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v4M17 5h4"/>',
  play:'<path d="M7 4.5v15l12-7.5z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  up:'<path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9z"/>',
  down:'<path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.8a2 2 0 0 0-1.8 1.1L12 22a3.1 3.1 0 0 1-3-3.9z"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  dice:'<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>',
  film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
  head:'<path d="M4 14a8 8 0 1 1 16 0v4a2 2 0 0 1-2 2h-1v-6h3M4 14h3v6H6a2 2 0 0 1-2-2z"/>',
  chev:'<path d="M6 9l6 6 6-6"/>',
  share:'<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  squarePlus:'<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>',
  dots:'<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  vdots:'<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  install:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 7.5v6M9.5 11l2.5 2.5 2.5-2.5M8 21h8"/>'
};
const IC = (n, sw) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
const ARR = `<span class="arr">${IC("chev",2)}</span>`;
const VERD = {later:"Позже", watching:"Читаю", liked:"Понравилось", seen:"Читал", disliked:"Не моё"};
const SHORT = {later:"Позже", watching:"Читаю", seen:"Читал", liked:"Зашло", disliked:"Не моё"};
const VIC = {later:"clock", watching:"book", liked:"up", seen:"check", disliked:"down"};

function toast(t){const el=$("#toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2400)}

/* ---------- хранение ---------- */
function localLoad(){try{const s=JSON.parse(localStorage.getItem(LS_KEY)||"null");if(s){state.profile=s.profile||"";state.items=s.items||[]}}catch(e){}}
function localSave(){try{localStorage.setItem(LS_KEY,JSON.stringify({profile:state.profile,items:state.items,updated:Date.now()}))}catch(e){}}
function save(){ clearTimeout(saveTimer); saveTimer=null; localSave(); if(window.Sync) Sync.schedule(); }
function saveSoon(){ localSave(); clearTimeout(saveTimer); saveTimer=setTimeout(save,900); }

/* ---------- записи списка ---------- */
function findItem(title){const n=norm(title);return state.items.find(i=>norm(i.title)===n)}
function setVerdict(rec, verdict){
  let it = findItem(rec.title);
  if(it){
    it.verdict = verdict; it.ts = Date.now();
    if(rec.note && !it.note) it.note = rec.note;
  } else {
    it = {title:rec.title, year:rec.year||"", kind:kindOf(rec.kind), verdict, ts:Date.now(),
          note:rec.note||"", hook:rec.hook||"", author:rec.author||""};
    state.items.unshift(it);
  }
  if(verdict==="watching" && it.progress==null) it.progress = Math.min(100, Math.max(0, +rec.progress || 0));
  save(); renderList();
  return it;
}
function removeItem(title){state.items=state.items.filter(i=>norm(i.title)!==norm(title));save();renderList()}

/* ---------- вкладки и чипы ---------- */
function showTab(name){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("on",x.dataset.tab===name));
  $("#pick").classList.toggle("hidden",name!=="pick");
  $("#list").classList.toggle("hidden",name!=="list");
  if(name==="list") renderList();
  window.scrollTo({top:0});
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showTab(b.dataset.tab));
document.querySelectorAll(".wrap .chips").forEach(g=>g.addEventListener("click",e=>{
  const c=e.target.closest(".chip");if(!c)return;
  g.querySelectorAll(".chip").forEach(x=>x.classList.toggle("on",x===c));
}));
const val = id => document.querySelector(`#${id} .chip.on`).dataset.v;

/* ---------- ИИ (через серверную функцию) ---------- */
const AI = {
  ready(){ return !!(CFG.supabaseUrl && CFG.supabaseAnonKey && CFG.aiEnabled); },
  async _post(body, signal){
    if(!this.ready()) throw {code:"no_server"};
    const token = (window.Auth && Auth.token && Auth.token()) || CFG.supabaseAnonKey;
    let r;
    try{
      r = await fetch(CFG.supabaseUrl.replace(/\/$/,"") + "/functions/v1/ai", {
        method:"POST", signal,
        headers:{"Content-Type":"application/json", apikey:CFG.supabaseAnonKey, Authorization:"Bearer "+token},
        body: JSON.stringify({app:APP, ...body})
      });
    }catch(e){ if(e && e.name==="AbortError") throw {code:"cancelled"}; throw {code:"network"}; }
    if(!r.ok){
      let code = r.status===401?"login":r.status===403?"not_allowed":r.status===429?"limit":"server";
      try{ const j=await r.json(); if(j && j.code) code=j.code; }catch(e){}
      throw {code};
    }
    return r;
  },
  // Потоковый ответ: текст приходит кусочками, onText({delta}) вызывается на каждый кусочек.
  async stream(prompt, {signal, onText, tier}={}){
    const r = await this._post({prompt, tier:tier||"default", stream:true}, signal);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let all = "";
    try{
      for(;;){
        const {done, value} = await reader.read();
        if(done) break;
        const delta = dec.decode(value, {stream:true});
        all += delta; onText && onText({delta});
      }
    }catch(e){ if(e && e.name==="AbortError") throw {code:"cancelled"}; throw e; }
    return {text: all};
  },
  async ask(prompt, {tier}={}){
    const r = await this._post({prompt, tier:tier||"quick", stream:false});
    const j = await r.json();
    return {text: j.text || ""};
  }
};
function parseJSON(t){
  const a=t.indexOf("{"), b=t.lastIndexOf("}");
  if(a<0||b<a) throw new Error("no json");
  return JSON.parse(t.slice(a,b+1));
}
function aiError(e){
  const c = e && e.code;
  return c==="no_server" ? "Подбор заработает, когда подключим сервер. Список уже можно вести."
       : c==="login" ? "Войдите, чтобы пользоваться подбором"
       : c==="not_allowed" ? "Подбор доступен только по приглашению. Напишите владельцу приложения"
       : c==="limit" ? "На сегодня подборы закончились. Лимит обновится завтра"
       : c==="network" ? "Нет связи с сервером. Проверьте интернет"
       : c==="empty" ? "Новых вариантов не нашлось. Попробуйте другое настроение или «Похоже на…»"
       : "Не получилось. Попробуйте ещё раз";
}

/* ---------- подбор ---------- */
function listBy(v){return state.items.filter(i=>i.verdict===v).map(i=>i.title+(i.author?` — ${i.author}`:"")+(i.note?` — ${i.note}`:"")).join("; ")||"—"}

function buildPrompt(count, surprise){
  const kind = val("kinds"), fmt = val("fmt");
  const kindTxt = kind==="fiction"?"только художественные книги (сюжет, история)":kind==="nonfiction"?"только нон-фикшн (полезные книги)":"художественные или нон-фикшн";
  const fmtTxt = fmt==="audio"?"Он хочет СЛУШАТЬ: выбирай книги, у которых есть хорошая аудиоверсия на русском, и укажи чтеца и длительность.":fmt==="read"?"Он хочет читать глазами (электронная или бумажная).":"Формат любой: подойдёт и аудио, и текст.";
  const sim = $("#similar").value.trim();
  const exclude = [...state.items.map(i=>i.title), ...shownThisVisit].join("; ") || "—";
  return `Ты — личный советчик по книгам для человека, который НЕ особо любит читать. Твоя задача — найти книги, от которых он не сможет оторваться. Подбери ровно ${count} ${count===1?"книгу":"книги"}: ${kindTxt}.

Его вкус (написал сам): ${state.profile || "не указан"}
Понравилось: ${listBy("liked")}
Читает сейчас: ${listBy("watching")}
Не понравилось: ${listBy("disliked")}

${surprise
  ? "Режим «Удиви меня»: одна неочевидная книга, которую он вряд ли знает, но которая очень вероятно его затянет."
  : `Настроение сейчас: ${val("moods")}.`}
${sim ? `Хочется чего-то в духе: ${sim} (это может быть фильм, сериал или книга).` : ""}
${fmtTxt}

НЕ предлагай (уже читал, в списке или уже предлагали): ${exclude}

Правила:
- только реально существующие книги, изданные на русском языке;
- простой, лёгкий язык, без тяжёлых длинных описаний; затягивает с первых страниц; короткие главы — плюс;
- для нон-фикшна — живо, с историями и примерами, без занудства и воды;
- разные по жанру и стилю, не три одинаковых;
- все варианты РАЗНЫЕ, ни одного повтора и ничего из списка «НЕ предлагай»;
- без спойлеров.

Ответь строго по одному JSON-объекту на строку (каждый объект целиком на одной строке), без массива, без нумерации и без текста вокруг. Внутри строк не используй прямые кавычки ", только «ёлочки». Формат каждой строки:
{"title":"название на русском","author":"автор","year":2015,"kind":"fiction или nonfiction","genre":"жанр коротко","pages":"примерно 320 стр.","audio":"например: аудио 9 ч, читает Игорь Князев — или пустая строка, если аудио нет или не знаешь","hook":"о чём в одном предложении","why":"1-2 предложения, почему именно ему, со ссылкой на его вкус"}`;
}

function isNew(x){
  if(!x || !x.title) return false;
  const n = norm(x.title);
  return !findItem(x.title) && !current.some(y=>norm(y.title)===n) && !shownThisVisit.some(t=>norm(t)===n);
}
// Читает ответ построчно (JSON Lines), показывает карточки по мере появления,
// останавливает запрос, когда набралось нужное число новых вариантов.
async function askStream(prompt, want, onRec){
  const ctl = new AbortController();
  let pending = "", got = 0;
  const eat = raw => {
    if(got>=want) return;
    const line = raw.trim().replace(/^```(json)?/,"").replace(/```$/,"").replace(/,\s*$/,"").trim();
    const a = line.indexOf("{"), b = line.lastIndexOf("}");
    if(a<0 || b<a) return;
    let x; try{ x = JSON.parse(line.slice(a,b+1)); }catch(e){ return; }
    if(!isNew(x)) return;
    onRec(x); got++;
    if(got>=want) ctl.abort();
  };
  try{
    await AI.stream(prompt, {tier:"default", signal:ctl.signal,
      onText:({delta})=>{ const lines=(pending+delta).split("\n"); pending=lines.pop(); lines.forEach(eat); }});
    if(pending.trim()) eat(pending);
  }catch(e){
    if(!(e && e.code==="cancelled")){ if(pending.trim()) eat(pending); if(!got) throw e; }
  }
  return got;
}

async function pick(surprise){
  if(busy) return;
  if(!AI.ready()){ $("#results").innerHTML = `<div class="status">${aiError({code:"no_server"})}</div>`; return; }
  busy = true; picking = true; $("#go").disabled = $("#surprise").disabled = true;
  const count = surprise?1:3;
  current = [];
  $("#results").innerHTML = `<div class="status"><span class="dots">Ищу, что вас затянет</span></div>`;
  $("#results").scrollIntoView({behavior:"smooth",block:"start"});
  try{
    for(let attempt=0; attempt<2 && current.length<count; attempt++){
      await askStream(buildPrompt(count+2, surprise), count-current.length, x=>{
        x.kind = kindOf(x.kind);
        shownThisVisit.push(x.title);
        current.push(x);
        renderResults();
      });
    }
    if(!current.length) throw {code:"empty"};
  }catch(e){
    if(!current.length) $("#results").innerHTML = `<div class="status">${aiError(e)}</div>`;
  }finally{
    busy=false; picking=false; $("#go").disabled = $("#surprise").disabled = false;
    if(current.length) renderResults();
  }
}
$("#go").onclick=()=>pick(false);
$("#surprise").onclick=()=>pick(true);

function links(x, small){
  const tq = encodeURIComponent(`${x.title} ${x.author||""} обзор книги`.replace(/\s+/g," "));
  const q = encodeURIComponent(`${x.title} ${x.author||""}`.trim());
  return `<div class="links${small?" sm":""}">
      <a class="find" href="https://www.litres.ru/search/?q=${q}" target="_blank" rel="noopener">${IC("book")}Литрес</a>
      <a class="find" href="https://www.youtube.com/results?search_query=${tq}" target="_blank" rel="noopener">${IC("play")}Обзор</a>
    </div>`;
}

function card(x, i, src){
  const it = findItem(x.title);
  const v = it && it.verdict;
  const acts = ["later","watching","seen","liked","disliked"];
  return `<div class="card ${v?"done":""}">
    <span class="kind">${KIND[x.kind]||""}${x.genre?" · "+esc(x.genre):""}</span>
    <h3>${esc(x.title)}</h3>
    <div class="meta">${esc(x.author||"")}${x.year?" · "+esc(x.year):""}${x.pages?" · "+esc(x.pages):""}</div>
    ${x.audio?`<div class="meta audio">${IC("head")}${esc(x.audio)}</div>`:""}
    <div class="hook">${esc(x.hook||"")}</div>
    ${x.why?`<div class="why">${esc(x.why)}</div>`:""}
    <div class="acts">
      ${acts.map(k=>`<button class="act ${v===k?"sel":""}" data-src="${src}" data-i="${i}" data-k="${k}">${IC(VIC[k])}${SHORT[k]}</button>`).join("")}
    </div>
    ${links(x)}
  </div>`;
}

function renderResults(){
  if(!current.length){ $("#results").innerHTML=""; return; }
  $("#results").innerHTML = current.map((x,i)=>card(x,i,"r")).join("") + (picking ? `<div class="status"><span class="dots">Подбираю ещё</span></div>` : `<div class="btns"><button class="btn ghost" style="flex:1" id="more">Не то, ещё варианты</button></div>
  <div class="note">Уже читали? Отметьте «Читал», «Зашло» или «Не моё». Чем больше отметок, тем точнее подборка.</div>`);
  const mb=$("#more"); if(mb) mb.onclick=()=>pick(current.length===1);
}

function renderNews(){ $("#news").innerHTML=""; }

function onAct(e){
  const b=e.target.closest(".act");if(!b)return;
  const x = b.dataset.src==="n" ? news.items[+b.dataset.i] : current[+b.dataset.i];
  if(!x) return;
  setVerdict(x,b.dataset.k);
  toast(b.dataset.k==="later"?"Добавил в «Хочу прочитать»":b.dataset.k==="watching"?"Добавил в «Читаю сейчас»":"Запомнил");
  renderResults(); renderNews();
}
$("#results").addEventListener("click",onAct);
$("#news").addEventListener("click",onAct);

/* ---------- мой список ---------- */
const EMPTY = {"watching": "Отметьте книгу «Читаю», и здесь будет прогресс в процентах", "liked": "Здесь будут книги, которые понравились", "disliked": "Здесь будет то, что не понравилось. Такое больше не предложу", "seen": "Здесь будут прочитанные книги"};

function renderList(){
  const later = state.items.filter(i=>i.verdict==="later").length;
  $("#laterCnt").textContent = later?later:"";
  if($("#list").classList.contains("hidden")) return;
  const groups=[["watching",IC("book")+"Читаю сейчас"],["later",IC("clock")+"Хочу прочитать"],["liked",IC("up")+"Понравилось"],["disliked",IC("down")+"Не зашло"],["seen",IC("check")+"Прочитал"]];
  const sub = i => [i.author,KIND[i.kind]].filter(Boolean).map(esc).join(" · ")+(i.note?" · "+esc(i.note):"");
  const t = i => `data-t="${esc(i.title)}"`;
  const del = i => `<button ${t(i)} data-k="del" title="Убрать" aria-label="Убрать">${IC("x")}</button>`;
  const yr = i => i.year?` <span class="yr">${esc(i.year)}</span>`:"";
  const open = k => openGroups.has(k)?"open":"";
  $("#lists").innerHTML = groups.map(([k,name])=>{
    const arr = state.items.filter(i=>i.verdict===k);
    let body;
    if(!arr.length && k!=="later"){
      body = `<div class="empty">${EMPTY[k]}</div>`;
    } else if(k==="watching"){
      body = arr.map(i=>`
      <div class="row watch"><div class="top"><div class="t"><b>${esc(i.title)}</b>${(i.author||i.note)?`<div>${esc([i.author,i.note].filter(Boolean).join(" · "))}</div>`:""}</div>
        <div class="mini">${del(i)}</div></div>
        <div class="bar"><i style="width:${i.progress||0}%"></i></div>
        <div class="prog"><span class="pv">Прочитано ${i.progress||0}%</span>
          <button ${t(i)} data-k="ep-">−10%</button><button ${t(i)} data-k="ep+">+10%</button>
          <button class="fin" ${t(i)} data-k="fin">${IC("check")}Дочитал</button></div></div>`).join("");
    } else if(k==="later"){
      body = arr.length ? arr.map(i=>`<div class="row stack"><div class="top"><div class="t"><b>${esc(i.title)}</b>${yr(i)}
        <div>${sub(i)}${i.hook?" · "+esc(i.hook):""}</div></div>
        <div class="mini"><button ${t(i)} data-k="watching" title="Начал читать" aria-label="Начал читать">${IC("book")}</button><button ${t(i)} data-k="liked" title="Прочитал, понравилось" aria-label="Понравилось">${IC("up")}</button><button ${t(i)} data-k="disliked" title="Не моё" aria-label="Не моё">${IC("down")}</button>${del(i)}</div></div>${links(i,true)}</div>`).join("")
        : `<div class="empty">Пока пусто. Добавляйте из подборок или то, что посоветовали</div>`;
    } else {
      body = arr.map(i=>`<div class="row"><div class="t"><b>${esc(i.title)}</b>${yr(i)}
        <div>${sub(i)}</div></div>
        <div class="mini">${del(i)}</div></div>`).join("");
    }
    return `<details class="sec fold" data-g="${k}" ${open(k)}><summary><h2>${name} <small>${arr.length||""}</small>${ARR}</h2></summary>${body}</details>`;
  }).join("");
}
$("#lists").addEventListener("toggle",e=>{
  const d=e.target; if(!d.dataset||!d.dataset.g) return;
  d.open ? openGroups.add(d.dataset.g) : openGroups.delete(d.dataset.g);
},true);
$("#lists").addEventListener("click",e=>{
  const b=e.target.closest("button[data-k]");if(!b)return;
  const k=b.dataset.k, it=findItem(b.dataset.t);
  if(k==="del") return removeItem(b.dataset.t);
  if(k==="ep+"||k==="ep-"){
    if(!it) return;
    it.progress = Math.min(100, Math.max(0, (it.progress||0) + (k==="ep+"?10:-10)));
    it.ts=Date.now(); renderList(); saveSoon(); return;
  }
  if(k==="fin"){
    setVerdict({title:b.dataset.t},"liked");
    toast("Отлично! Подбираю, что почитать дальше");
    $("#similar").value=b.dataset.t;
    showTab("pick"); pick(false); return;
  }
  setVerdict({title:b.dataset.t}, k);
  toast(k==="watching"?"Отлично, слежу за прогрессом":"Запомнил");
});

/* ---------- быстро добавить (текст; голос — через микрофон на клавиатуре телефона) ---------- */
async function quickAdd(){
  const text=$("#quick").value.trim(); if(!text) return;
  const btn=$("#addBtn"); btn.disabled=true; btn.textContent="Разбираю…";
  let rec=null;
  if(AI.ready()){
    try{
      const r = await AI.ask(`Человек ведёт личный список книг. Он написал или надиктовал фразу: «${text}».
Определи, о какой книге речь, и что он хочет отметить.
Ответь только JSON-объектом без текста вокруг:
{"title":"название книги на русском (исправь опечатки и ошибки распознавания речи)","author":"автор, если знаешь","kind":"fiction или nonfiction","verdict":"later (посоветовали / хочу прочитать) | watching (начал читать или слушать) | liked (прочитал, понравилось) | disliked (не понравилось, бросил)","progress":0,"note":"кто посоветовал или короткая заметка из фразы, иначе пустая строка"}`, {tier:"quick"});
      rec = parseJSON(r.text);
    }catch(e){ rec=null; }
  }
  if(!rec || !rec.title) rec = {title:text.replace(/^[«"]|[»"]$/g,""), verdict:"later", kind:"fiction"};
  const v = ["later","watching","liked","disliked"].includes(rec.verdict)?rec.verdict:"later";
  setVerdict(rec, v);
  $("#quick").value="";
  btn.disabled=false; btn.textContent="Добавить";
  toast(`«${rec.title}» → ${VERD[v]}`);
}
$("#addBtn").onclick=quickAdd;
$("#quick").addEventListener("keydown",e=>{if(e.key==="Enter")quickAdd()});

$("#saveProfile").onclick=()=>{state.profile=$("#profile").value.trim();save();toast("Сохранил")};

/* ---------- подсказка «Установить на экран» ---------- */
const Install = (() => {
  let deferred = null;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const isAndroid = /Android/.test(ua);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone===true;
  const SEEN = APP+".installHint";
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; if($(".sheet")) show(currentTab); });
  window.addEventListener("appinstalled", () => { close(); toast("Готово! Приложение на экране"); });
  let currentTab = isIOS ? "ios" : isAndroid ? "android" : "desktop";

  const steps = {
    ios: [
      `Откройте эту страницу в <b>Safari</b> (в других браузерах на iPhone пункта может не быть).`,
      `Нажмите «Поделиться» ${IC("share")} внизу экрана. В новых iOS она спрятана в меню ${IC("dots")} справа внизу.`,
      `Пролистайте и выберите «На экран „Домой“» ${IC("squarePlus")}.`,
      `Нажмите «Добавить». Иконка появится рядом с остальными приложениями.`
    ],
    android: [
      `Откройте страницу в <b>Chrome</b>.`,
      `Нажмите меню ${IC("vdots")} в правом верхнем углу.`,
      `Выберите «Установить приложение» или «Добавить на главный экран».`,
      `Подтвердите, и иконка появится на рабочем столе.`
    ],
    desktop: [
      `Откройте страницу в <b>Chrome</b>, <b>Яндекс Браузере</b> или <b>Edge</b>.`,
      `Нажмите значок установки ${IC("install")} справа в адресной строке или откройте меню браузера → «Установить приложение».`,
      `В Safari на Mac: меню «Файл» → «Добавить в Dock».`
    ]
  };
  function show(tab){
    currentTab = tab || currentTab;
    const native = deferred && currentTab!=="ios";
    $("#sheet").innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle">
      <h3 id="shTitle">Поставьте приложение на экран</h3>
      <p>Так оно будет открываться одним нажатием, как обычное приложение: без браузера и адресной строки.</p>
      <div class="seg chips">${[["ios","iPhone"],["android","Android"],["desktop","Компьютер"]].map(([k,n])=>`<button class="chip ${k===currentTab?"on":""}" data-os="${k}">${n}</button>`).join("")}</div>
      ${native?`<div class="btns"><button class="btn main" id="shInstall">Установить</button></div><p>Или вручную:</p>`:""}
      <ol>${steps[currentTab].map(s=>`<li><span>${s}</span></li>`).join("")}</ol>
      <div class="btns"><button class="btn ghost" style="flex:1" id="shClose">Понятно</button></div>
    </div></div>`;
    $(".sheet-bg").onclick = e => { if(e.target.classList.contains("sheet-bg")) close(); };
    $("#shClose").onclick = close;
    $(".sheet .seg").onclick = e => { const c=e.target.closest("[data-os]"); if(c) show(c.dataset.os); };
    const ib = $("#shInstall");
    if(ib) ib.onclick = async () => { const d=deferred; deferred=null; d.prompt(); try{ await d.userChoice; }catch(e){} close(); };
  }
  function close(){ $("#sheet").innerHTML = ""; try{ localStorage.setItem(SEEN,"1"); }catch(e){} }
  function maybeAuto(){
    if(standalone()) { $("#howInstall").classList.add("hidden"); return; }
    let seen = false; try{ seen = !!localStorage.getItem(SEEN); }catch(e){}
    if(!seen) setTimeout(()=>show(), 1200);
  }
  return {show, maybeAuto};
})();
$("#howInstall").onclick = () => Install.show();

/* ---------- запуск ---------- */
function renderAll(){ $("#profile").value = state.profile; renderList(); renderNews(); }
$("#surprise").innerHTML = IC("dice") + "<span>Удиви</span>";
$("#addTitle").insertAdjacentHTML("afterbegin", IC("plus"));
$("#tasteTitle").insertAdjacentHTML("afterbegin", IC("target"));
$("#tasteTitle").insertAdjacentHTML("beforeend", ARR);
localLoad(); renderAll();
Install.maybeAuto();

/* Автообновление: при открытии и при возврате в приложение проверяем новую версию в фоне. */
if("serviceWorker" in navigator && location.protocol!=="file:"){
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  // Новая версия включается незаметно: не перезагружаем экран у человека на глазах,
  // а ждём, когда приложение свернут. При следующем открытии уже будет новая версия.
  let pending = false;
  const reloadNow = () => { if(reloaded) return; reloaded = true; location.reload(); };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(!hadController) return;
    if(document.visibilityState === "hidden") reloadNow(); else pending = true;
  });
  document.addEventListener("visibilitychange", () => { if(pending && document.visibilityState === "hidden") reloadNow(); });
  navigator.serviceWorker.register("sw.js", {updateViaCache:"none"}).then(reg => {
    const check = () => reg.update().catch(()=>{});
    document.addEventListener("visibilitychange", () => { if(document.visibilityState==="visible") check(); });
  }).catch(()=>{});
}
