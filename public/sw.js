const VERSION = 'signal-monitor-v5';
const STATIC_CACHE = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';
const OFFLINE_FALLBACK = '/offline.html';
const PRECACHE_URLS = [
  '/',
  OFFLINE_FALLBACK,
  '/manifest.json',
  '/icons/favicon.ico',
  '/icons/favicon-16x16.png',
  '/icons/favicon-32x32.png',
  '/icons/favicon-48x48.png',
  '/icons/apple-touch-icon.png',
  '/icons/apple-touch-icon-180x180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/Ok_ppg_bp_glucose_final.onnx',
  '/ort-wasm-simd-threaded.mjs',
  '/ort-wasm-simd-threaded.wasm'
];

const CACHE_FIRST_PATHS = [
  /^\/$/,
  /^\/_next\/static\//,
  /^\/icons\//,
  /^\/manifest\.json$/,
  /^\/offline\.html$/,
  /^\/Ok_ppg_bp_glucose_final\.onnx$/,
  /^\/ort-wasm-simd-threaded(\.asyncify|\.jsep)?\.(mjs|wasm)$/
];

function isCacheFirstPath(pathname) {
  return CACHE_FIRST_PATHS.some((pattern) => pattern.test(pathname));
}

function shouldHandle(requestUrl) {
  return requestUrl.origin === self.location.origin && !requestUrl.pathname.startsWith('/api/');
}

async function storeResponse(cacheName, request, response) {
  if (!response || !response.ok) {
    return response;
  }

  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function fetchAndCache(cacheName, request) {
  const response = await fetch(request);
  return storeResponse(cacheName, request, response);
}

async function cacheKnownUrls(urls) {
  const cache = await caches.open(STATIC_CACHE);

  await Promise.all(urls.map(async (url) => {
    try {
      const absoluteUrl = new URL(url, self.location.origin);
      if (!shouldHandle(absoluteUrl)) {
        return;
      }

      const request = new Request(absoluteUrl.toString(), { credentials: 'same-origin' });
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
      }
    } catch (error) {
      console.warn('[sw] Skipped caching', url, error);
    }
  }));
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(cacheKnownUrls(PRECACHE_URLS));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS' || !Array.isArray(event.data.payload)) {
    return;
  }

  event.waitUntil(cacheKnownUrls(event.data.payload));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (!shouldHandle(requestUrl)) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cachedResponse =
        await cache.match(event.request, { ignoreSearch: true }) ||
        await cache.match('/') ||
        await cache.match(OFFLINE_FALLBACK);

      if (cachedResponse) {
        event.waitUntil(fetchAndCache(STATIC_CACHE, event.request).catch(() => undefined));
        return cachedResponse;
      }

      try {
        return await fetchAndCache(STATIC_CACHE, event.request);
      } catch (error) {
        return (await cache.match(OFFLINE_FALLBACK)) || Response.error();
      }
    })());
    return;
  }

  if (isCacheFirstPath(requestUrl.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        return await fetchAndCache(STATIC_CACHE, event.request);
      } catch (error) {
        return (await cache.match(event.request, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);

    try {
      const response = await fetchAndCache(RUNTIME_CACHE, event.request);
      return response;
    } catch (error) {
      const cachedResponse = await cache.match(event.request, { ignoreSearch: true });
      return cachedResponse || Response.error();
    }
  })());
});
