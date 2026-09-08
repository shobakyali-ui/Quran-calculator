const CACHE_NAME='quran-test-plan-offline-v1.3';
const ASSETS=['./','./index.html','./mushaf-data.js','./calculator-core.js','./manifest.webmanifest'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  // Navigation is network-first so a newly deployed version appears immediately.
  if(event.request.mode==='navigate'){
    event.respondWith(
      fetch(event.request).then(resp=>{
        if(resp && resp.ok){
          const clone=resp.clone();
          caches.open(CACHE_NAME).then(c=>c.put('./index.html',clone));
        }
        return resp;
      }).catch(()=>caches.match('./index.html'))
    );
    return;
  }

  // Static local assets remain cache-first for offline use.
  event.respondWith(
    caches.match(event.request).then(hit=>hit||fetch(event.request).then(resp=>{
      if(resp && resp.ok){
        const clone=resp.clone();
        caches.open(CACHE_NAME).then(c=>c.put(event.request,clone));
      }
      return resp;
    }))
  );
});
