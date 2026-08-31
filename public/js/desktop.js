// =====================================================
//  DESKTOP BRIDGE — Tauri runtime adapter
//  No-op in the regular web build.
// =====================================================

(() => {
  const available = Boolean(window.__TAURI_INTERNALS__ && window.__TAURI__);

  const unavailableResult = () => Promise.resolve(null);

  if (!available) {
    window.nexoDesktop = {
      available: false,
      syncReminders: unavailableResult,
      upsertReminder: unavailableResult,
      removeReminder: unavailableResult,
      clearReminders: unavailableResult,
      snoozeReminder: unavailableResult,
      schedulerStatus: unavailableResult,
      sendTestNotification: unavailableResult,
      getNotificationPermission: unavailableResult,
      openOAuthUrl: unavailableResult,
      relayOAuthCallbacks: unavailableResult,
    };
    return;
  }

  document.documentElement.classList.add('nexo-desktop');

  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const autostart = window.__TAURI__.autostart;

  function toEpoch(date, time) {
    if (!date || !time) return null;
    const value = new Date(`${date}T${time}:00`).getTime();
    return Number.isFinite(value) ? value : null;
  }

  function toDesktopReminder(reminder, userId, fireAtOverride = null) {
    const fireAt = fireAtOverride ?? toEpoch(reminder.date, reminder.time);
    if (!reminder?.id || !userId || !fireAt || reminder.done) return null;

    return {
      id: String(reminder.id),
      userId: String(userId),
      title: String(reminder.title || 'Lembrete'),
      body: String(reminder.desc || 'Hora do seu lembrete!'),
      sound: String(reminder.sound || 'padrão'),
      fireAt,
      advanceMinutes: Math.max(0, Number(reminder.advance) || 0),
    };
  }

  async function syncReminders(reminders, userId) {
    if (!userId) return;
    const normalized = reminders
      .map(reminder => toDesktopReminder(reminder, userId))
      .filter(Boolean);
    await invoke('sync_reminders', {
      request: { userId: String(userId), reminders: normalized },
    });
  }

  async function upsertReminder(reminder, userId) {
    const normalized = toDesktopReminder(reminder, userId);
    if (!normalized) {
      if (reminder?.id && userId) await removeReminder(reminder.id, userId);
      return;
    }
    await invoke('upsert_reminder', { reminder: normalized });
  }

  async function removeReminder(reminderId, userId) {
    if (!reminderId || !userId) return;
    await invoke('remove_reminder', {
      reminderId: String(reminderId),
      userId: String(userId),
    });
  }

  async function clearReminders(userId) {
    if (!userId) return;
    await invoke('clear_reminders', { userId: String(userId) });
  }

  async function snoozeReminder(reminder, userId, delayMs) {
    const normalized = toDesktopReminder(reminder, userId, Date.now() + delayMs);
    if (!normalized) return;
    normalized.advanceMinutes = 0;
    await invoke('upsert_reminder', { reminder: normalized });
  }

  async function schedulerStatus() {
    return invoke('scheduler_status');
  }

  async function sendTestNotification() {
    return invoke('send_test_notification');
  }

  async function requestNotificationPermission() {
    // No Windows desktop a permissão é controlada pelo próprio sistema.
    // Diferente do navegador, não existe prompt confiável para solicitar aqui.
    return 'granted';
  }

  async function getNotificationPermission() {
    return 'granted';
  }

  async function openOAuthUrl(url) {
    await invoke('open_oauth_url', { url: String(url) });
  }

  async function relayOAuthCallbacks() {
    const urls = await invoke('take_oauth_callbacks');
    for (const url of urls || []) {
      document.dispatchEvent(new CustomEvent('nexo:oauth-callback', {
        detail: { url },
      }));
    }
    return urls || [];
  }

  async function initializeDesktopSettings() {
    const panel = document.getElementById('desktop-settings');
    const toggle = document.getElementById('desktop-autostart-toggle');
    const status = document.getElementById('desktop-autostart-status');
    const notificationButton = document.getElementById('desktop-test-notification-btn');
    const notificationStatus = document.getElementById('desktop-notification-status');
    if (!panel || !toggle || !status) return;

    panel.style.display = 'block';
    try {
      toggle.checked = await autostart.isEnabled();
      status.textContent = toggle.checked
        ? 'O Nexo será iniciado em segundo plano com o Windows.'
        : 'Ative para receber lembretes depois de reiniciar o computador.';
    } catch (error) {
      console.error('Não foi possível consultar a inicialização automática:', error);
      toggle.disabled = true;
      status.textContent = 'Configuração indisponível nesta instalação.';
    }

    toggle.addEventListener('change', async () => {
      toggle.disabled = true;
      try {
        if (toggle.checked) await autostart.enable();
        else await autostart.disable();
        status.textContent = toggle.checked
          ? 'O Nexo será iniciado em segundo plano com o Windows.'
          : 'Inicialização automática desativada.';
      } catch (error) {
        console.error('Erro ao alterar inicialização automática:', error);
        toggle.checked = !toggle.checked;
        status.textContent = 'Não foi possível salvar esta configuração.';
      } finally {
        toggle.disabled = false;
      }
    });

    if (notificationButton && notificationStatus) {
      try {
        const scheduler = await schedulerStatus();
        const count = Number(scheduler?.pendingJobs) || 0;
        notificationStatus.textContent = `${count} alerta(s) agendado(s) neste computador.`;
      } catch (error) {
        console.error('Não foi possível consultar a agenda de alertas:', error);
      }

      notificationButton.addEventListener('click', async () => {
        notificationButton.disabled = true;
        notificationStatus.textContent = 'Enviando teste ao Windows...';
        try {
          await sendTestNotification();
          notificationStatus.textContent = 'Teste enviado. Verifique também a Central de Notificações do Windows.';
        } catch (error) {
          console.error('Erro no teste de notificação:', error);
          notificationStatus.textContent = 'O Windows recusou a notificação. Confira as notificações do Nexo nas Configurações do Windows.';
        } finally {
          notificationButton.disabled = false;
        }
      });
    }
  }

  window.nexoDesktop = {
    available: true,
    syncReminders,
    upsertReminder,
    removeReminder,
    clearReminders,
    snoozeReminder,
    schedulerStatus,
    sendTestNotification,
    getNotificationPermission,
    requestNotificationPermission,
    openOAuthUrl,
    relayOAuthCallbacks,
  };

  listen('nexo-reminder-fired', event => {
    document.dispatchEvent(new CustomEvent('nexo:desktop-reminder-fired', {
      detail: event.payload,
    }));
  }).catch(error => console.error('Erro ao conectar eventos do Nexo Desktop:', error));

  listen('nexo-oauth-callback-available', () => {
    relayOAuthCallbacks().catch(error => {
      console.error('Erro ao receber retorno do login Google:', error);
    });
  }).catch(error => console.error('Erro ao conectar o retorno OAuth:', error));

  initializeDesktopSettings();
})();
