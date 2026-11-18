/* Service worker: приложение открывается мгновенно из памяти телефона и работает без интернета.
   Все файлы приложения берутся из кэша. Новая версия скачивается в фоне: при каждом изменении
   приложения меняется номер CACHE ниже, телефон замечает новый sw.js, заранее скачивает свежие файлы
   и app.js один раз тихо перезагружает страницу.
   ВАЖНО: при любом изменении файлов приложения увеличивать номер версии в CACHE. */
const CACHE = "knigi-v48";
const SHELL = ["./", "index.html", "app.js", "config.js", "sync.js", "admin.js", "taste.js", "vendor/supabase.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/shops/lit.png", "icons/shops/cg.png", "icons/shops/oz.png", "icons/shops/ym.png", "icons/shops/ll.png",
  "fonts/manrope-cyrillic-wght-normal.woff2", "fonts/manrope-latin-wght-normal.woff2",
  "fonts/unbounded-cyrillic-wght-normal.woff2", "fonts/unbounded-latin-wght-normal.woff2"];

self.addEventListener("install", e => {
  // cache: "reload" — берём файлы прямо с сервера, мимо кэша браузера, чтобы новая версия была действительно новой
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, {cache: "reload"}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // Supabase и прочее — напрямую в сеть
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(caches.open(CACHE).then(c => c.match(key, {ignoreSearch: true}).then(hit => hit ||
    fetch(req).then(res => { if (res.ok && req.mode !== "navigate") c.put(req, res.clone()); return res; })
      .catch(() => c.match("index.html")))));
});
