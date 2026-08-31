const port = process.env.NEXO_DEBUG_PORT || '9333';
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
const target = targets.find(item => item.type === 'page' && item.url.includes('tauri.localhost'));
if (!target) throw new Error('WebView do Nexo não encontrado.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const result = await new Promise(resolve => {
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id === 1) resolve(message);
  });
  socket.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: 'window.nexoDesktop.sendTestNotification()',
      awaitPromise: true,
      returnByValue: true,
    },
  }));
});

socket.close();
if (result.result?.exceptionDetails || result.error) {
  throw new Error(JSON.stringify(result));
}
console.log('Notificação nativa de teste aceita pelo Windows.');
