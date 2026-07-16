// 9jaCash Service Worker — For Push Notifications
const CACHE_NAME = '9jaCash-v1';
const urlsToCache = [
  'index.html',
  'start.html',
  'dashboard.html',
  '9jaCash.png',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request).then(function(response) {
      if (response) { return response; }
      return fetch(event.request);
    })
  );
});

// Handle push notifications
self.addEventListener('push', function(event) {
  const data = event.data.json();
  const options = {
    body: data.body || 'You have a new notification from 9jaCash!',
    icon: '9jaCash.png',
    badge: '9jaCash.png',
    tag: data.tag || '9jaCash-general',
    requireInteraction: true,
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || '9jaCash', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow('dashboard.html')
    );
  }
});
