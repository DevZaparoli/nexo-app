const port = process.env.NEXO_DEBUG_PORT || '9333';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.includes('tauri.localhost'));

if (!target) throw new Error('WebView do Nexo não encontrado.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const logEntries = [];
let nextId = 1;

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
    return;
  }

  if (message.method === 'Log.entryAdded') logEntries.push(message.params.entry);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
  const message = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  const exception = message.result?.exceptionDetails;
  if (message.error || exception) {
    throw new Error(exception?.exception?.description || JSON.stringify(message));
  }

  return message.result?.result?.value;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

if (process.argv.includes('--cleanup')) {
  await evaluate(`(() => {
    localStorage.removeItem('nexo-sidebar-collapsed');
    for (const key of Object.keys(localStorage)) {
      if (key.includes('code-verifier')) localStorage.removeItem(key);
    }
    location.reload();
    return true;
  })()`);
  console.log('Estado temporário do smoke test removido.');
  socket.close();
  process.exit(0);
}

await send('Page.reload', { ignoreCache: true });
await new Promise((resolve) => setTimeout(resolve, 2500));

const results = await evaluate(`(async () => {
  const waitFor = async (predicate, timeout = 10000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return null;
  };

  const test = (name, passed, detail) => ({ name, passed: Boolean(passed), detail });
  const output = [];
  const sidebarStorageBefore = localStorage.getItem('nexo-sidebar-collapsed');
  const sidebarWasCollapsed = document.getElementById('sidebar').classList.contains('collapsed');
  const oauthStorageBefore = Object.fromEntries(
    Object.keys(localStorage)
      .filter(key => key.includes('code-verifier'))
      .map(key => [key, localStorage.getItem(key)]),
  );
  const csp = await fetch(location.href).then(response => response.headers.get('content-security-policy'));
  output.push(test(
    'CSP restrita aos atributos de evento',
    csp?.includes("script-src-attr 'unsafe-inline'")
      && csp?.includes("style-src-attr 'unsafe-inline'")
      && /script-src [^;]*sha256-/.test(csp),
    csp,
  ));

  const authTabs = [...document.querySelectorAll('.auth-tab')];
  authTabs[1].click();
  output.push(test(
    'Aba Criar conta',
    getComputedStyle(document.getElementById('tab-register')).display === 'block' && authTabs[1].classList.contains('active'),
    authTabs.map(tab => ({ text: tab.textContent.trim(), active: tab.classList.contains('active') })),
  ));
  authTabs[0].click();

  document.querySelector('#tab-login .btn-primary').click();
  const authError = document.getElementById('auth-error');
  output.push(test(
    'Botão Entrar',
    /preencha e-mail e senha/i.test(authError.textContent),
    authError.textContent.trim(),
  ));

  document.querySelector('#tab-login .btn-ghost').click();
  output.push(test(
    'Botão Esqueci minha senha',
    /digite seu e-mail/i.test(authError.textContent),
    authError.textContent.trim(),
  ));

  const googleButton = document.getElementById('google-login-btn');
  output.push(test(
    'Google oculto no aplicativo desktop',
    getComputedStyle(googleButton).display === 'none',
    getComputedStyle(googleButton).display,
  ));

  output.push(test(
    'Teste de notificação disponível',
    Boolean(document.getElementById('desktop-test-notification-btn')),
    document.getElementById('desktop-test-notification-btn')?.textContent.trim(),
  ));

  await checkPermBanner();
  output.push(test(
    'Banner de permissão oculto no desktop',
    getComputedStyle(document.getElementById('perm-banner')).display === 'none',
    getComputedStyle(document.getElementById('perm-banner')).display,
  ));

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'flex';
  renderList();

  const today = document.querySelector('.nav-item[data-view="today"]');
  today.click();
  output.push(test(
    'Navegação Hoje',
    today.classList.contains('active') && document.getElementById('view-title').textContent === 'Lembretes de hoje',
    document.getElementById('view-title').textContent,
  ));

  const highPriority = [...document.querySelectorAll('.filter-chip')]
    .find(button => /alta prioridade/i.test(button.textContent));
  highPriority.click();
  output.push(test('Filtro Alta prioridade', highPriority.classList.contains('active'), highPriority.className));

  const sidebar = document.getElementById('sidebar');
  const wasCollapsed = sidebar.classList.contains('collapsed');
  document.querySelector('.sidebar-collapse-btn').click();
  output.push(test(
    'Recolher menu',
    sidebar.classList.contains('collapsed') !== wasCollapsed,
    sidebar.className,
  ));
  sidebar.classList.toggle('collapsed', sidebarWasCollapsed);
  if (sidebarStorageBefore === null) localStorage.removeItem('nexo-sidebar-collapsed');
  else localStorage.setItem('nexo-sidebar-collapsed', sidebarStorageBefore);

  const newReminder = [...document.querySelectorAll('button')]
    .find(button => /novo lembrete/i.test(button.textContent));
  newReminder.click();
  const modal = document.getElementById('modal-overlay');
  output.push(test('Abrir Novo lembrete', modal.classList.contains('show'), modal.className));

  const repeatTab = [...document.querySelectorAll('.modal .tab')]
    .find(tab => /repetição/i.test(tab.textContent));
  repeatTab.click();
  output.push(test(
    'Aba Repetição do modal',
    getComputedStyle(document.getElementById('tab-repeticao')).display === 'block' && repeatTab.classList.contains('active'),
    getComputedStyle(document.getElementById('tab-repeticao')).display,
  ));

  const repeatSelect = document.getElementById('f-repeat');
  repeatSelect.value = 'weekly';
  repeatSelect.dispatchEvent(new Event('change', { bubbles: true }));
  output.push(test(
    'Opção de repetição semanal',
    getComputedStyle(document.getElementById('f-weekdays-group')).display === 'block',
    getComputedStyle(document.getElementById('f-weekdays-group')).display,
  ));

  const cancel = [...modal.querySelectorAll('button')].find(button => /cancelar/i.test(button.textContent));
  cancel.click();
  output.push(test('Fechar modal', !modal.classList.contains('show'), modal.className));

  showInAppNotif('smoke-test', 'Lembrete de teste', 'Corpo do alerta');
  const inAppNotification = document.getElementById('inapp-notif');
  const notificationRect = inAppNotification.getBoundingClientRect();
  output.push(test(
    'Layout da notificação interna',
    getComputedStyle(inAppNotification).position === 'fixed'
      && Math.round(notificationRect.width) === 320
      && Math.round(notificationRect.top) === 20,
    { width: notificationRect.width, top: notificationRect.top, position: getComputedStyle(inAppNotification).position },
  ));
  closeInAppNotif();
  await new Promise(resolve => setTimeout(resolve, 450));
  output.push(test(
    'Notificação interna removida após fechar',
    getComputedStyle(inAppNotification).display === 'none'
      && inAppNotification.getAttribute('aria-hidden') === 'true',
    {
      display: getComputedStyle(inAppNotification).display,
      opacity: getComputedStyle(inAppNotification).opacity,
      ariaHidden: inAppNotification.getAttribute('aria-hidden'),
    },
  ));

  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  switchAuthTab('login');

  return output;
})()`);

await new Promise((resolve) => setTimeout(resolve, 300));
const securityErrors = logEntries.filter((entry) => entry.level === 'error' && entry.source === 'security');
const report = {
  passed: results.every((result) => result.passed) && securityErrors.length === 0,
  results,
  securityErrors,
};

console.log(JSON.stringify(report, null, 2));
socket.close();

if (!report.passed) process.exitCode = 1;
