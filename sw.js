// Service worker: lets the app open offline.
// - Your own files: network first (so deployments show up immediately), cache as fallback.
// - Pinned libraries and fonts (Firebase SDK, Excel export, Google Fonts): cache first.
// - Firebase Auth / Firestore traffic is never touched here; Firestore has its own offline cache.
const CACHE = "amc-v2";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/auth.js", "js/calc.js", "js/firebase.js", "js/firebase-config.js"];
const CDN = ["www.gstatic.com", "fonts.gstatic.com", "fonts.googleapis.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match("index.html")))
    );
  } else if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
