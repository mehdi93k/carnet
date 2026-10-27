// ===== Service worker de Carnet : le site s'ouvre même sans Internet =====
//
// Stratégie :
//   - fichiers du site : réseau d'abord (toujours la dernière version), copie en secours
//     si la connexion est coupée ou trop lente ;
//   - polices et bibliothèques (CDN) : copie d'abord, mise à jour en arrière-plan.
// Les notes ne passent jamais par ici : elles restent dans le stockage du navigateur,
// donc vider ce cache ne fait rien perdre.
// Changer VERSION à chaque mise en ligne efface les anciennes copies.

const VERSION = 'carnet-2026-10-27-a';
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'app.js', 'voice.js', 'files.js', 'schema.js', 'graph.js', 'agenda.js', 'tasks.js',
  'review.js', 'home.js', 'ai.js', 'qr.js', 'pwa.js', 'start.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const LIBRARIES = [
  'https://cdn.jsdelivr.net/npm/lucide@0.460.0/dist/umd/lucide.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    // Les bibliothèques : si l'une échoue, l'installation continue quand même
    await Promise.all(LIBRARIES.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Réseau d'abord, avec un délai maximum ; la copie sert si le réseau ne répond pas
async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  network.catch(() => null); // hors ligne : l'erreur est gérée plus bas
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const fast = await Promise.race([network, timeout]);
    if (fast) return fast;
  } catch (error) { /* hors ligne */ }
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' })
    || (request.mode === 'navigate' ? await cache.match('index.html') : null);
  if (cached) return cached;
  return network; // pas de copie : on attend quand même le réseau
}

// Copie d'abord, mise à jour en arrière-plan
async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const update = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await update) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // l'assistant IA (POST) passe directement
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});

// Clic sur une notification de rappel : on ouvre (ou on montre) Carnet
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow('./?view=agenda');
  })());
});
