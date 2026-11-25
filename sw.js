/*
 * Офлайн-режим «Гири».
 * При установке скачивает ВСЁ: страницу, скрипты, стили, нейросеть позы и WASM-движок.
 * Если хоть один файл не скачался — установка прерывается и браузер повторит её позже,
 * чтобы приложение никогда не считало себя готовым к офлайну наполовину.
 * Все пути считаются от папки приложения, поэтому оно работает и в корне сайта, и в подпапке.
 */
const VERSION = '2026-11-25-2';
const CACHE = `girya-offline-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const at = path => new URL(String(path).replace(/^\//, ''), SCOPE).href;
const MANIFEST = at('offline-assets.json');
const SHELL = at('./');
const MODEL = 'mediapipe/pose_landmarker_lite.task';

async function download(url) {
  const response = await fetch(url, { cache: 'reload', signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Не сохранён файл: ${url}`);
  return response;
}

async function assetList(response) {
  const data = await response.clone().json();
  const assets = Array.isArray(data.assets) ? data.assets.map(a => String(a).replace(/^\//, '')) : [];
  if (!assets.includes(MODEL) || !assets.some(a => a.endsWith('.css'))) throw new Error('Неполный список офлайн-файлов');
  return { version: data.version, assets };
}

async function fillCache(cache) {
  const manifest = await download(MANIFEST);
  const { assets } = await assetList(manifest);
  for (let i = 0; i < assets.length; i += 4) {
    await Promise.all(assets.slice(i, i + 4).map(async a => cache.put(at(a), await download(at(a)))));
  }
  await cache.put(SHELL, await download(SHELL));
  await cache.put(MANIFEST, manifest);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await fillCache(await caches.open(CACHE));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Старые версии удаляем только когда новая полностью скачана.
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('girya-offline-') && n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (!['CHECK_OFFLINE', 'REPAIR_OFFLINE'].includes(event.data?.type)) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      if (event.data.type === 'REPAIR_OFFLINE') await fillCache(cache);
      const manifest = await cache.match(MANIFEST);
      if (!manifest) { event.ports[0]?.postMessage({ ready: false, version: VERSION }); return; }
      const { assets } = await assetList(manifest);
      const urls = [SHELL, ...assets.map(at)];
      const present = await Promise.all(urls.map(u => cache.match(u).then(Boolean)));
      event.ports[0]?.postMessage({ ready: present.every(Boolean), version: VERSION, files: present.filter(Boolean).length, total: urls.length });
    } catch { event.ports[0]?.postMessage({ ready: false, version: VERSION }); }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Открытие приложения (с любыми ?параметрами) — сохранённая главная страница.
    const root = url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html';
    const key = request.mode === 'navigate' && root ? SHELL : url.href.split('#')[0].split('?')[0];
    const cached = await cache.match(key) || await caches.match(request);
    // Без ожидания сети: подготовленное приложение запускается даже при «висящем» интернете.
    if (cached) return cached;
    try { return await fetch(request); } catch { return Response.error(); }
  })());
});
