// Portal service worker: makes the portal installable and shows new-lead pushes.
// No caching of lead data: everything personal stays network-only.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: 'New lead', body: '' } }
  e.waitUntil(self.registration.showNotification(d.title || 'New lead', { body: d.body || '', icon: '/brand/mark.png', badge: '/brand/mark.png', data: { url: d.url || '/app/' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = (e.notification.data && e.notification.data.url) || '/app/'
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes('/app/')) { c.navigate(url); return c.focus() }
    return self.clients.openWindow(url)
  }))
})
