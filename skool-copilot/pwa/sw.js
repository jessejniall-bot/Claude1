/* Skool Community Copilot — PWA service worker (app-shell cache) */
var CACHE = "sc-shell-v3";
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

// Cache-first for the shell; everything else (Supabase, AI providers)
// always goes to the network.
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
