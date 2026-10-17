/* Service worker — Ponto & Finanças (funciona offline) */
const CACHE = "ponto-financas-v3";
const SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png",
               "./icon-maskable-192.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const CDN_HOSTS = ["cdn.tailwindcss.com"];
const TAILWIND = "https://cdn.tailwindcss.com/";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    // Tailwind (estilos): guarda já na instalação, se houver internet
    try { await c.add(new Request(TAILWIND, { mode: "no-cors" })); } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function swr(req) {
  return caches.open(CACHE).then((cache) =>
    cache.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Tailwind CDN: usa o cache e atualiza em segundo plano
  if (CDN_HOSTS.includes(url.hostname)) { e.respondWith(swr(req)); return; }

  // Imagem de capa (Storage público do Supabase): cache + atualização em segundo plano
  if (url.hostname.endsWith(".supabase.co") && url.pathname.indexOf("/storage/v1/object/public/") === 0) {
    e.respondWith(swr(req)); return;
  }

  // Dados (REST/Auth) e demais origens: sempre rede — o app guarda os dados localmente
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro (4s), senão o index em cache
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cached = () => caches.match("./index.html").then((r) => r || caches.match("./"));
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(req, { signal: ctl.signal });
        clearTimeout(t);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./index.html", copy)); }
        return res;
      } catch (_) { return (await cached()) || Response.error(); }
    })());
    return;
  }

  // Arquivos do app: cache primeiro
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
