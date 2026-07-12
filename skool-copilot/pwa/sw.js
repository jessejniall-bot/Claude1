/* Skool Community Copilot — PWA service worker (app-shell cache) */
var CACHE = "sc-shell-v8";
var SHELL = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./charts.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "../extension/shared/config.js",
  "../extension/shared/supabase-lite.js",
  "../extension/shared/key-vault.js",
  "../extension/shared/ai-providers.js",
  "../extension/shared/health-engine.js",
  "../extension/shared/unicode-style.js",
  "../extension/shared/default-pillars.js",
  "../extension/shared/demo-data.js",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Network-first for the shell so deploys show up on the next normal
// reload; the cache is the offline fallback. Cross-origin requests
// (Supabase, AI providers) are never intercepted.
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(event.request, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
