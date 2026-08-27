// Service worker minimal : permet à l'app d'être installable (PWA) et
// met en cache l'essentiel pour un chargement plus rapide au retour.
// Les données du planning viennent toujours de Supabase en direct — ce
// cache ne concerne que les fichiers de l'app elle-même (pas hors-ligne complet).

const CACHE_NAME = "baustellenplanung-v1";
const CORE_ASSETS = ["/", "/index.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

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
  // Ne jamais mettre en cache les appels à l'API Supabase : les données
  // doivent toujours être fraîches.
  if (event.request.url.includes("supabase.co")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
