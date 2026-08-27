// Service worker : permet à l'app d'être installable (PWA).
// La page HTML elle-même est TOUJOURS récupérée depuis le réseau en priorité
// (jamais figée en cache) — seuls les fichiers statiques (icônes, manifest)
// bénéficient du cache pour un chargement plus rapide.
// Les données du planning viennent toujours de Supabase en direct.

const CACHE_NAME = "baustellenplanung-v2";
const CORE_ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.url.includes("supabase.co")) return;

  // Navigation (la page elle-même) : réseau d'abord, jamais figée en cache.
  // Repli sur le cache uniquement si vraiment hors-ligne.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Fichiers statiques : cache d'abord, repli réseau.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
