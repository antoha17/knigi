/* «Мой вкус» с помощью ИИ. Файл одинаковый в обоих приложениях; вопросы анкеты — в TASTE_CFG (app.js).
   1) Анкета при первом входе: если «Мой вкус» пустой — несколько вопросов чипами, ИИ составляет текст.
   2) «По моим отметкам»: ИИ дополняет вкус по тому, что человек отметил.
   3) «Своими словами»: человек пишет или надиктовывает как получится, ИИ аккуратно добавляет к вкусу.
   Если ИИ недоступен (лимит, нет связи), анкета всё равно сохраняет ответы простым текстом. */
"use strict";

const Taste = (() => {
  const C = TASTE_CFG;
  const DONE = APP + ".onbDone";
  let answers = {};

  const clean = t => String(t || "").trim()
    .replace(/^[«"“]+|[»"”]+$/g, "")
    .replace(/\s—\s/g, " – ")
    .trim();
  const RULES = "Пиши от первого лица, как будто человек сам рассказывает о себе. Простые короткие предложения, без списков, без заголовков, без эмодзи, без длинного тире «—». Не выдумывай того, чего нет в данных. Ответь только самим текстом.";

  /* ---------- анкета ---------- */
  function need(){
    if(state.profile && state.profile.trim()) return false;
    try{ if(localStorage.getItem(DONE)) return false; }catch(e){}
    return true;
  }
  function maybeStart(){
    if(document.body.classList.contains("gated") || document.body.classList.contains("onb-open")) return;
    if(need()) showQuestions();
  }
  function showQuestions(){
    answers = {};
    document.body.classList.add("onb-open");
    window.scrollTo({top: 0});
    $("#onb").innerHTML = `<div class="onb">
      <div class="onb-head"><h3>Расскажите о своём вкусе</h3><p>Полминуты, и подборки сразу будут точнее. Потом всё можно поменять в разделе «Мой вкус».</p></div>
      ${C.questions.map(q => `<div class="onb-q" data-q="${q.id}"><h4>${q.t}${q.multi ? " <small>можно несколько</small>" : q.text ? " <small>необязательно</small>" : ""}</h4>
        ${q.text ? `<input id="onb-${q.id}" placeholder="${esc(q.ph || "")}" autocomplete="off">`
                 : `<div class="chips">${q.opts.map(o => `<button class="chip" data-v="${esc(o)}">${esc(o)}</button>`).join("")}</div>`}
      </div>`).join("")}
      <div class="btns onb-go"><button class="btn main" id="onbGo">Готово</button></div>
      <button class="onb-skip" id="onbSkip">Пропустить</button>
    </div>`;
    $("#onb").querySelectorAll(".onb-q").forEach(box => {
      const q = C.questions.find(x => x.id === box.dataset.q);
      const chips = box.querySelector(".chips"); if(!chips) return;
      chips.onclick = e => {
        const c = e.target.closest(".chip"); if(!c) return;
        if(q.multi) c.classList.toggle("on");
        else chips.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c && !c.classList.contains("on")));
      };
    });
    $("#onbSkip").onclick = () => close();
    $("#onbGo").onclick = finish;
  }
  function collect(){
    const a = {};
    for(const q of C.questions){
      if(q.text){ const v = $("#onb-" + q.id).value.trim(); if(v) a[q.id] = v; }
      else { const v = [...$("#onb").querySelectorAll(`[data-q="${q.id}"] .chip.on`)].map(c => c.dataset.v); if(v.length) a[q.id] = v.join(", "); }
    }
    return a;
  }
  // Запасной вариант без ИИ: ответы простым текстом.
  function plain(a){
    return C.questions.filter(q => a[q.id]).map(q => q.plain.replace("{}", q.text ? a[q.id] : a[q.id].toLowerCase())).join(" ");
  }
  async function finish(){
    answers = collect();
    if(!Object.keys(answers).length){ toast("Выберите хоть что-нибудь или нажмите «Пропустить»"); return; }
    const btn = $("#onbGo"); btn.disabled = true; btn.textContent = "Составляю ваш вкус…";
    const lines = C.questions.filter(q => answers[q.id]).map(q => `${q.t} ${answers[q.id]}`).join("\n");
    let text = "";
    try{
      const r = await AI.ask(`Человек ответил на короткую анкету о том, какие ${C.subject} ему нравятся.\n${lines}\n\nНапиши его «вкус»: 3–5 предложений. Этот текст потом будет подсказкой для подбора. ${RULES}`, {kind: "taste"});
      text = clean(r.text);
    }catch(e){}
    if(!text) text = plain(answers);
    showResult(text);
  }
  function showResult(text){
    $("#onb").innerHTML = `<div class="onb">
      <div class="onb-head"><h3>Вот ваш вкус</h3><p>Так я понял ваши ответы. Это будет учитываться в каждом подборе.</p></div>
      <div class="onb-result" id="onbText">${esc(text)}</div>
      <textarea id="onbEdit" class="hidden">${esc(text)}</textarea>
      <div class="btns onb-go"><button class="btn main" id="onbOk">Всё верно</button></div>
      <button class="onb-skip" id="onbFix">Поправить текст</button>
    </div>`;
    window.scrollTo({top: 0});
    $("#onbFix").onclick = () => {
      $("#onbText").classList.add("hidden"); const ed = $("#onbEdit"); ed.classList.remove("hidden"); ed.focus();
      $("#onbOk").textContent = "Сохранить"; $("#onbFix").classList.add("hidden");
    };
    $("#onbOk").onclick = () => {
      const ed = $("#onbEdit"), t = (ed.classList.contains("hidden") ? text : ed.value).trim();
      setProfile(t); close(); toast("Вкус сохранён");
    };
  }
  function close(){
    try{ localStorage.setItem(DONE, "1"); }catch(e){}
    document.body.classList.remove("onb-open");
    $("#onb").innerHTML = "";
    showTab("pick");
  }
  function setProfile(t){ state.profile = t; $("#profile").value = t; save(); }

  /* ---------- инструменты в «Моём вкусе» ---------- */
  async function busyRun(btn, label, fn){
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = label;
    try{ await fn(); }catch(e){ toast(aiError(e)); }
    finally{ btn.disabled = false; btn.innerHTML = old; }
  }
  function fromMarks(){
    const marks = C.marks.map(([v, name]) => `${name}: ${listBy(v)}`).join("\n");
    if(!state.items.length){ toast("Пока нет отметок. Отмечайте на карточках «Понравилось» и «Не моё»"); return; }
    busyRun($("#tasteMarks"), "Смотрю отметки…", async () => {
      const cur = $("#profile").value.trim();
      const r = await AI.ask(`Человек описал свой вкус (${C.subject}): «${cur || "пока не описан"}».\nЕго отметки:\n${marks}\n\nОбнови описание вкуса: сохрани всё верное из старого текста и добавь выводы из отметок (что нравится, какое настроение, что не заходит). 3–6 предложений. ${RULES}`, {kind: "taste"});
      const t = clean(r.text); if(!t) throw {code: "server"};
      $("#profile").value = t;
      toast("Готово. Проверьте и нажмите «Сохранить»");
    });
  }
  function toggleWords(){
    const box = $("#tasteWordsBox"); box.classList.toggle("hidden");
    if(!box.classList.contains("hidden")) $("#tasteWordsIn").focus();
  }
  function mergeWords(){
    const said = $("#tasteWordsIn").value.trim();
    if(!said){ toast("Напишите или надиктуйте пару фраз"); return; }
    busyRun($("#tasteWordsGo"), "Добавляю…", async () => {
      const cur = $("#profile").value.trim();
      const r = await AI.ask(`Текущее описание вкуса человека (${C.subject}): «${cur || "пока пусто"}».\nОн добавил своими словами (возможно, надиктовано, с ошибками распознавания речи): «${said}».\n\nОбъедини в одно аккуратное описание вкуса: сохрани старое, добавь новое, исправь ошибки, убери повторы. 3–6 предложений. ${RULES}`, {kind: "taste"});
      const t = clean(r.text); if(!t) throw {code: "server"};
      $("#profile").value = t; $("#tasteWordsIn").value = ""; $("#tasteWordsBox").classList.add("hidden");
      toast("Готово. Проверьте и нажмите «Сохранить»");
    });
  }

  function init(){
    const tools = $("#tasteTools"); if(!tools) return;
    tools.innerHTML = `<button class="btn ghost" id="tasteMarks">${IC("spark")}По моим отметкам</button><button class="btn ghost" id="tasteWords">${IC("chat")}Своими словами</button>`;
    $("#tasteMarks").onclick = fromMarks;
    $("#tasteWords").onclick = toggleWords;
    $("#tasteWordsGo").onclick = mergeWords;
  }
  init();
  return {maybeStart, showQuestions};
})();
window.Taste = Taste;
