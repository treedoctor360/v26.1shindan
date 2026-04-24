// ============================================================
// 樹木点検システム - Service Worker
// ============================================================
const CACHE_NAME = 'tree-inspect-v24';
const TILE_CACHE = 'tree-inspect-tiles-v24';

// オフラインで動作するために必要なファイル
const APP_SHELL = [
  './',                     // start_url
  './index.html',
  './manifest.json',
];

// CDNから読み込む外部リソース（キャッシュ可能なもの）
const CDN_ASSETS = [
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&display=swap',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // アプリ本体をキャッシュ
      for (const url of APP_SHELL) {
        try { await cache.add(url); } catch(e) { console.warn('[SW] App shell miss:', url); }
      }
      // CDNリソースをキャッシュ
      for (const url of CDN_ASSETS) {
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (res.ok) await cache.put(url, res);
        } catch(e) { console.warn('[SW] CDN miss:', url); }
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 地図タイルは別キャッシュ
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(tileStrategy(event.request));
    return;
  }

  // Google Fontsはキャッシュ優先
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request, CACHE_NAME));
    return;
  }

  // CDNリソースはキャッシュ優先
  const isCDN = CDN_ASSETS.some(a => event.request.url.startsWith(a.split('?')[0]));
  if (isCDN) {
    event.respondWith(cacheFirst(event.request, CACHE_NAME));
    return;
  }

  // 自分のオリジンのファイルはネットワーク優先＋キャッシュ
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

// キャッシュ優先戦略（CDN/Fonts用）
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch(e) {
    return new Response('Offline', { status: 503 });
  }
}

// ネットワーク優先戦略（アプリ本体用）
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch(e) {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

// 地図タイル専用戦略（容量制限付き）
async function tileStrategy(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      cache.put(request, res.clone());
      trimTileCache(cache, 500);
    }
    return res;
  } catch(e) {
    return new Response(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

// タイルキャッシュの上限管理
async function trimTileCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const toDelete = keys.slice(0, keys.length - maxEntries);
    for (const key of toDelete) await cache.delete(key);
  }
}