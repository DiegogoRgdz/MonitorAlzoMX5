const CACHE = 'alzo-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/assets/css/styles.css',
  '/assets/js/app.js',
  '/manifest.webmanifest'
];
self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e)=>{
  const { request } = e;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);
  if(url.origin === location.origin){
    e.respondWith(caches.match(request).then(cached=>cached || fetch(request).then(res=>{
      const resClone = res.clone();
      caches.open(CACHE).then(c=>c.put(request, resClone));
      return res;
    }).catch(()=>cached)));
  }
});
