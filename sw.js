const CACHE_VERSION = 'kharcha-hisab-v' + new Date().toISOString().slice(0,10).replace(/-/g,'');
const CACHE_NAME = CACHE_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './auth.js',
  './trips.js',
  './firebase-config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Clean up old caches on every service worker activation
self.addEventListener('install', (event)=>{
  console.log('[SW] Installing cache:', CACHE_NAME);
  event.waitUntil(
    caches.keys().then(keys => {
      const oldCaches = keys.filter(k => k.startsWith('kharcha-hisab-v') && k !== CACHE_NAME);
      return Promise.all([
        ...oldCaches.map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        }),
        caches.open(CACHE_NAME).then(cache => {
          console.log('[SW] Populating cache with app shell...');
          return cache.addAll(APP_SHELL).catch(err => {
            console.error('Cache addAll failed:', err);
            return Promise.all(
              APP_SHELL.map(url => 
                cache.add(url).catch(() => console.warn(`Failed to cache: ${url}`))
              )
            );
          });
        })
      ]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  console.log('[SW] Activating, claiming clients...');
  event.waitUntil(
    caches.keys().then(keys => {
      const keysToDelete = keys.filter(k => k.startsWith('kharcha-hisab-') && k !== CACHE_NAME);
      console.log('[SW] Cleaning up old caches:', keysToDelete);
      return Promise.all(keysToDelete.map(k => caches.delete(k)));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const request = event.request;
  const url = request.url;

  if(request.method !== 'GET') return;

  // External APIs - network first with cache fallback
  if(url.includes('firebaseio.com') || url.includes('googleapis.com') || url.includes('gstatic.com')){
    event.respondWith(
      fetch(request)
        .then(response => {
          if(response && response.status === 200 && response.type !== 'error'){
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, responseClone)).catch(err => {
              console.warn('Cache put failed:', err);
            });
            return response;
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // App shell assets (your own html/js/css) - network first, cache fallback.
  // This means whenever the device has internet, it always fetches the
  // latest deployed files first, and only falls back to the cached copy
  // when offline. This is what makes updates (like this fix) show up
  // immediately on next load instead of waiting for the cache to expire.
  event.respondWith(
    fetch(request)
      .then(response => {
        if(response && response.status === 200 && response.type !== 'error'){
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, responseClone)).catch(err => {
            console.warn('Cache put failed:', err);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request).then(cached => {
          if(cached) return cached;
          if(request.mode === 'navigate'){
            return caches.match('./index.html').catch(() =>
              new Response('Offline', {status: 503})
            );
          }
          return new Response('Offline - resource not available', {status: 503});
        });
      })
  );
});

// Handle cache clear messages from client
self.addEventListener('message', (event) => {
  if(event.data && event.data.type === 'CLEAR_CACHE'){
    console.log('[SW] Clearing all caches...');
    caches.keys().then(keys => {
      Promise.all(keys.map(k => caches.delete(k)));
    });
  }
});
