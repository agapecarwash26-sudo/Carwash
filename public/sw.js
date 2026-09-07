const VERSION='aquaflow-v3';
const STATIC=['./','./index.html','./manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==location.origin)return;if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(VERSION).then(c=>c.put(event.request,copy));return response;}).catch(()=>caches.match('./index.html')));return;}event.respondWith(caches.match(event.request).then(cached=>{const network=fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(c=>c.put(event.request,copy));}return response;}).catch(()=>cached);return cached||network;}));});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
