self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 갤러리 공유로 들어온 사진을 받아 캐시에 넣고 앱을 연다
  if (e.request.method === 'POST' && url.pathname === '/share') {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const files = fd.getAll('photos');
      const cache = await caches.open('shared');
      await cache.put('count', new Response(String(files.length)));
      for (let i = 0; i < files.length; i++) await cache.put('photo' + i, new Response(files[i]));
      return Response.redirect('/?shared=1', 303);
    })());
    return;
  }

  // 앱 화면은 오프라인에서도 열리도록 (네트워크 우선, 실패 시 캐시)
  if (e.request.method === 'GET' && url.origin === location.origin && !url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (res.ok) (await caches.open('app')).put(e.request, res.clone());
        return res;
      } catch {
        return (await caches.match(e.request)) || Response.error();
      }
    })());
  }
});
