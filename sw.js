const CACHE_NAME = 'muni-chascomus-v07';
const CACHE_VERSION = 'v07';

// Assets esenciales para funcionamiento offline mínimo
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// Dominios a NO cachear (API externas)
const EXTERNAL_DOMAINS = [
  'n8n.chascomus.gob.ar',
  'script.google.com',
  'docs.google.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Función para verificar si es una URL externa
function isExternalUrl(url) {
  return EXTERNAL_DOMAINS.some(domain => url.includes(domain));
}

self.addEventListener('install', event => {
  console.log('[SW] Instalando...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cacheando assets estáticos');
      return cache.addAll(STATIC_ASSETS);
    }).catch(err => console.error('[SW] Error cacheando:', err))
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME && key.startsWith('muni-chascomus-')) {
            console.log('[SW] Eliminando cache viejo:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Cache limpiado, tomando control');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Ignorar métodos no-GET, extensiones de navegador y URLs externas específicas
  if (request.method !== 'GET' || 
      url.protocol === 'chrome-extension:' ||
      url.protocol === 'moz-extension:' ||
      isExternalUrl(url.href)) {
    return;
  }
  
  // Estrategia: Stale-while-revalidate para navegación
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        const fetchPromise = fetch(request).then(networkResponse => {
          // Cachear la nueva versión para próxima vez
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, networkResponse.clone());
            });
          }
          return networkResponse.clone();
        }).catch(() => {
          // Si falla red, devolver el cache (offline)
          if (cachedResponse) return cachedResponse;
          return caches.match('./index.html'); // Fallback final
        });
        
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }
  
  // Para assets estáticos: Cache First
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) {
        // Actualizar cache en background (stale-while-revalidate)
        fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const toCache = networkResponse.clone(); // clonar antes de cualquier async
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, toCache);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const toCache = networkResponse.clone(); // clonar ANTES del return y del async
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, toCache);
          });
        }
        return networkResponse; // body intacto, ya se clonó arriba
      }).catch(() => {
        // Fallback para imágenes rotas
        if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
          return caches.match('./icon-192.png');
        }
        return new Response('Recurso no disponible offline', { status: 404 });
      });
    })
  );
});