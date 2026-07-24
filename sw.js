self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(clients.claim()));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // 갤러리에서 공유된 사진 받기
  if (e.request.method === "POST" && url.pathname.endsWith("/share")) {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const files = fd.getAll("photos");
      const cache = await caches.open("shared");
      await cache.put("count", new Response(String(files.length)));
      for (let i = 0; i < files.length; i++) {
        await cache.put("photo" + i, new Response(files[i]));
      }
      return Response.redirect("./index.html?shared=1", 303);
    })());
    return;
  }

  // 오프라인 지원: 네트워크 우선, 실패 시 캐시
  if (e.request.method === "GET" && url.origin === location.origin) {
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        const cache = await caches.open("app");
        cache.put(e.request, res.clone());
        return res;
      } catch {
        const hit = await caches.match(e.request);
        return hit || Response.error();
      }
    })());
  }
});
