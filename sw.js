const CACHE_NAME = 'kharcha-hisab-v4';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './trips.js',
  './firebase-config.js',
  './manifest.json'
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(APP_SHELL).catch(err => {
          console.error('Cache addAll failed:', err);
          // Continue anyway - some files may fail but app should still work
          return Promise.all(
            APP_SHELL.map(url => 
              cache.add(url).catch(() => console.warn(`Failed to cache: ${url}`))
            )
          );
        });
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event)=>{
  const url = event.request.url;
  
  // External APIs - network first with cache fallback
  if(url.includes('firebaseio.com') || url.includes('googleapis.com') || url.includes('gstatic.com')){
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if(response && response.status === 200 && response.type !== 'error'){
            const cache = caches.open(CACHE_NAME);
            cache.then(c => c.put(event.request, response.clone()));
            return response;
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell - cache first, then network
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if(cached) return cached;
        return fetch(event.request)
          .then(response => {
            if(!response || response.status !== 200 || response.type === 'error'){
              return response;
            }
            const cache = caches.open(CACHE_NAME);
            cache.then(c => c.put(event.request, response.clone()));
            return response;
          })
          .catch(() => {
            // Offline fallback
            if(event.request.mode === 'navigate'){
              return caches.match('./index.html');
            }
            return new Response('Offline - resource not available', {status: 503});
          });
      })
  );
});
