import { writeFile } from 'node:fs/promises';

const port = process.env.NEXO_DEBUG_PORT || '9333';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page' && item.url.includes('tauri.localhost'));

if (!target) {
  throw new Error('WebView do Nexo não encontrado.');
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const events = [];
let nextId = 1;

socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver(message);
    }
    return;
  }

  if (
    message.method === 'Runtime.exceptionThrown' ||
    message.method === 'Runtime.consoleAPICalled' ||
    message.method === 'Log.entryAdded'
  ) {
    events.push(message);
  }
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
  const response = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (response.error || response.result?.exceptionDetails) {
    throw new Error(JSON.stringify(response, null, 2));
  }

  return response.result?.result?.value;
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

if (process.argv.includes('--reload')) {
  await send('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

const state = await evaluate(`(() => {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };

  const describe = (element) => element ? {
    tag: element.tagName,
    id: element.id,
    classes: element.className,
    text: element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 100),
    display: getComputedStyle(element).display,
    visibility: getComputedStyle(element).visibility,
    opacity: getComputedStyle(element).opacity,
    pointerEvents: getComputedStyle(element).pointerEvents,
    zIndex: getComputedStyle(element).zIndex,
    rect: (() => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })(),
  } : null;

  const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const clickable = [...document.querySelectorAll('button, a, input, select, textarea, [onclick], [role="button"]')];

  return {
    readyState: document.readyState,
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    body: describe(document.body),
    screens: Object.fromEntries(['loading-screen', 'auth-screen', 'app-screen'].map((id) => [id, describe(document.getElementById(id))])),
    functions: Object.fromEntries([
      'loginGoogle',
      'switchAuthTab',
      'openReminderModal',
      'restoreSidebarState',
      'toggleSidebar',
      'navigateTo',
    ].map((name) => [name, typeof window[name]])),
    desktop: {
      exists: Boolean(window.nexoDesktop),
      available: window.nexoDesktop?.available,
      tauri: Boolean(window.__TAURI__),
      notificationApi: Boolean(window.__TAURI__?.notification),
      permissionBanner: describe(document.getElementById('perm-banner')),
    },
    center: describe(center),
    visibleFixed: [...document.querySelectorAll('body *')]
      .filter((element) => visible(element) && ['fixed', 'absolute'].includes(getComputedStyle(element).position))
      .map(describe)
      .filter((item) => item.rect.width > innerWidth * 0.7 && item.rect.height > innerHeight * 0.7),
    clickables: clickable.filter(visible).slice(0, 30).map(describe),
  };
})()`);

const tabTest = await evaluate(`(() => {
  const tabs = [...document.querySelectorAll('.auth-tab')];
  const before = tabs.map((tab) => ({ text: tab.textContent.trim(), active: tab.classList.contains('active') }));
  const targetTab = tabs.find((tab) => /criar conta/i.test(tab.textContent));
  targetTab?.click();
  return {
    found: Boolean(targetTab),
    before,
    after: tabs.map((tab) => ({ text: tab.textContent.trim(), active: tab.classList.contains('active') })),
    loginDisplay: getComputedStyle(document.getElementById('tab-login')).display,
    registerDisplay: getComputedStyle(document.getElementById('tab-register')).display,
  };
})()`);

const screenshot = await send('Page.captureScreenshot', { format: 'png' });
const screenshotPath = new URL('../webview-diagnostic.png', import.meta.url);
await writeFile(screenshotPath, Buffer.from(screenshot.result.data, 'base64'));

console.log(JSON.stringify({ state, tabTest, events, screenshot: screenshotPath.pathname }, null, 2));
socket.close();
