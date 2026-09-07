const CACHE='nvqplus-v4';
const LOCAL=['./','./index.html','./app.css','./app.js','./qr-compact.js','./course-core.js','./unit-102.js','./units-234-235.js','./unit-238.js','./units-303-300-502.js','./unit-313.js','./unit-690.js','./unit-701.js','./unit-828.js','./unit-837.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const REMOTE=[
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(LOCAL).then(()=>Promise.allSettled(REMOTE.map(u=>cache.add(u))))));
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(res=>{
    const copy=res.clone();
    caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});
    return res;
  }).catch(()=>caches.match('./index.html'))));
});
