// =====================================================
//  SERVICE WORKER — Notificações em background
// =====================================================

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Recebe mensagem do app para agendar notificação
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE') {
    const { id, title, body, delay } = e.data;
    scheduleNotif(id, title, body, delay);
  }
  if (e.data?.type === 'CANCEL') {
    cancelNotif(e.data.id);
  }
});

const timers = {};

function scheduleNotif(id, title, body, delay) {
  if (timers[id]) clearTimeout(timers[id]);
  if (delay <= 0) return;
  timers[id] = setTimeout(() => {
    self.registration.showNotification('RemindMe: ' + title, {
      body: body || 'Hora do seu lembrete!',
      icon: '/public/icons/icon-192.png',
      badge: '/public/icons/icon-192.png',
      tag: 'reminder-' + id,
      vibrate: [200, 100, 200],
      requireInteraction: true,
      actions: [
        { action: 'done', title: '✅ Concluir' },
        { action: 'snooze', title: '⏰ Adiar 10min' }
      ]
    });
    // Notifica o app para marcar como feito
    self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'FIRED', id }));
    });
  }, delay);
}

function cancelNotif(id) {
  if (timers[id]) { clearTimeout(timers[id]); delete timers[id]; }
}

// Clique na notificação
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'done') {
    self.clients.matchAll().then(clients => {
      clients.forEach(c => c.postMessage({ type: 'MARK_DONE', id: e.notification.tag.replace('reminder-','') }));
    });
  } else if (e.action === 'snooze') {
    const tag = e.notification.tag;
    const id  = tag.replace('reminder-','');
    scheduleNotif(id, e.notification.title.replace('RemindMe: ',''), e.notification.body, 10 * 60 * 1000);
  } else {
    e.waitUntil(self.clients.openWindow('/'));
  }
});
