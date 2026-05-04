// Service Worker for SS Money Resource PWA
const CACHE_NAME = 'ss-money-v6';
const urlsToCache = [
  '/api/user/',
  '/api/user/styles.css',
  '/api/user/script.js',
  '/api/user/manifest.json',
  '/api/user/icons/icon-72x72.png',
  '/api/user/icons/icon-96x96.png',
  '/api/user/icons/icon-128x128.png',
  '/api/user/icons/icon-144x144.png',
  '/api/user/icons/icon-152x152.png',
  '/api/user/icons/icon-192x192.png',
  '/api/user/icons/icon-384x384.png',
  '/api/user/icons/icon-512x512.png'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.log('Cache error:', err))
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Always fetch latest app script so business logic updates are not stuck in cache.
  if (event.request.url.includes('/api/user/script.js')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('/api/user/')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(response => {
          // Don't cache API calls
          if (event.request.url.includes('/api/') && 
              !event.request.url.includes('/api/user/')) {
            return response;
          }
          // Cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        });
      })
      .catch(() => {
        // Return offline page if available
        return caches.match('/api/user/');
      })
  );
});
