// =====================================================
//  APP — Lembretes com Supabase CRUD + Notificações
// =====================================================

const CAT_COLORS  = { Trabalho:'#7c6ff7', Saúde:'#22c97a', Pessoal:'#f5a623', Financeiro:'#e24b4a', Estudos:'#5dcaa5' };
const PRI_COLORS  = { normal:'#5a5a72', alta:'#f5a623', urgente:'#e24b4a' };
const REPEAT_LABEL = { none:'', daily:'Diário', weekly:'Semanal', monthly:'Mensal' };

let reminders     = [];
let editingId     = null;
let currentView   = 'all';
let currentFilter = 'all';
let selectedSound = 'padrão';
let swReg         = null;
let autoCheckInterval = null;

// =====================================================
//  SERVICE WORKER
// =====================================================

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('/sw.js');
    // Recebe mensagens do SW
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'FIRED')     autoMarkDone(e.data.id);
      if (e.data?.type === 'MARK_DONE') toggleDone(e.data.id);
    });
  } catch(err) { console.warn('SW error:', err); }
}

// =====================================================
//  SUPABASE CRUD
// =====================================================

async function loadReminders() {
  showLoading(true);
  const { data, error } = await sb
    .from('reminders')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('reminder_at', { ascending: true });

  showLoading(false);
  if (error) { console.error(error); return; }

  reminders = (data || []).map(dbToLocal);
  renderList();
  scheduleAllNotifications();
  startAutoCheck();
}

async function insertReminder(r) {
  const { data, error } = await sb
    .from('reminders')
    .insert([localToDb(r)])
    .select()
    .single();
  if (error) { console.error(error); showToast('Erro', 'Não foi possível salvar.'); return null; }
  return dbToLocal(data);
}

async function updateReminder(r) {
  const { error } = await sb
    .from('reminders')
    .update(localToDb(r))
    .eq('id', r.id)
    .eq('user_id', currentUser.id);
  if (error) console.error(error);
}

async function deleteReminderDb(id) {
  const { error } = await sb
    .from('reminders')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);
  if (error) console.error(error);
}

// =====================================================
//  CONVERSÃO local ↔ DB
// =====================================================

function localToDb(r) {
  const dt = r.date && r.time ? new Date(r.date + 'T' + r.time).toISOString() : null;
  return {
    user_id:      currentUser.id,
    title:        r.title,
    description:  r.desc,
    reminder_at:  dt,
    category:     r.cat,
    priority:     r.priority,
    repeat_type:  r.repeat,
    sound:        r.sound,
    advance_min:  r.advance,
    done:         r.done,
    repeat_end:   r.repeatEnd || null,
  };
}

function dbToLocal(row) {
  const dt = row.reminder_at ? new Date(row.reminder_at) : null;
  return {
    id:        row.id,
    title:     row.title,
    desc:      row.description || '',
    date:      dt ? dt.toISOString().slice(0,10) : '',
    time:      dt ? dt.toTimeString().slice(0,5) : '',
    cat:       row.category || 'Pessoal',
    priority:  row.priority || 'normal',
    repeat:    row.repeat_type || 'none',
    sound:     row.sound || 'padrão',
    advance:   row.advance_min || 0,
    done:      row.done || false,
    repeatEnd: row.repeat_end || '',
  };
}

// =====================================================
//  AUTO-CHECK: marca como feito após horário passar
// =====================================================

function startAutoCheck() {
  if (autoCheckInterval) clearInterval(autoCheckInterval);
  autoCheckInterval = setInterval(checkOverdueReminders, 30000); // a cada 30s
  checkOverdueReminders(); // roda imediatamente
}

async function checkOverdueReminders() {
  const now = new Date();
  for (const r of reminders) {
    if (r.done || !r.date || !r.time) continue;
    const dt = new Date(r.date + 'T' + r.time);
    // Se passou mais de 1 minuto do horário e não está feito
    if ((now - dt) > 60000) {
      await autoMarkDone(r.id);
    }
  }
}

async function autoMarkDone(id) {
  const r = reminders.find(x => x.id === id);
  if (!r || r.done) return;
  r.done = true;
  renderList();
  await updateReminder(r);
  showToast('✅ ' + r.title, 'Marcado como concluído automaticamente');
}

// =====================================================
//  RENDERIZAÇÃO
// =====================================================

function getToday() { return new Date().toISOString().slice(0,10); }
function isOverdue(r) {
  if (r.done || !r.date) return false;
  return new Date(r.date + 'T' + (r.time || '23:59')) < new Date();
}
function isToday(r) { return r.date === getToday(); }

function updateStats() {
  document.getElementById('s-total').textContent = reminders.length;
  document.getElementById('s-today').textContent = reminders.filter(r => isToday(r) && !r.done).length;
  document.getElementById('s-late').textContent  = reminders.filter(r => isOverdue(r)).length;
  document.getElementById('s-done').textContent  = reminders.filter(r => r.done).length;
  document.getElementById('badge-all').textContent   = reminders.filter(r => !r.done).length;
  document.getElementById('badge-today').textContent = reminders.filter(r => isToday(r) && !r.done).length;
}

function getFiltered() {
  let list = [...reminders];
  const q  = document.getElementById('search-input').value.toLowerCase();
  if (q) list = list.filter(r => r.title.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q));

  if (currentView === 'today')         list = list.filter(r => isToday(r));
  else if (currentView === 'upcoming') list = list.filter(r => r.date > getToday());
  else if (currentView === 'done')     list = list.filter(r => r.done);
  else if (currentView.startsWith('cat:')) list = list.filter(r => r.cat === currentView.slice(4));

  if (currentFilter === 'alta')   list = list.filter(r => r.priority === 'alta' || r.priority === 'urgente');
  if (currentFilter === 'repeat') list = list.filter(r => r.repeat !== 'none');

  return list.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.date + 'T' + a.time) - new Date(b.date + 'T' + b.time);
  });
}

function renderList() {
  updateStats();
  const list = getFiltered();
  const el   = document.getElementById('reminders-list');

  if (!list.length) {
    el.innerHTML = `<div class="empty"><i class="ti ti-mood-empty"></i><div>Nenhum lembrete encontrado</div><div style="font-size:12px;margin-top:6px">Crie um novo lembrete com o botão acima</div></div>`;
    return;
  }

  el.innerHTML = list.map(r => {
    const ov   = isOverdue(r);
    const col  = CAT_COLORS[r.cat] || '#888';
    const pcol = PRI_COLORS[r.priority] || '#888';
    const dt   = r.date ? new Date(r.date + 'T' + (r.time || '00:00')) : null;
    const fmt  = dt ? dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short' }) + ' às ' + r.time : '—';

    return `
    <div class="reminder-card${r.done ? ' done' : ''}">
      <button class="check-btn${r.done ? ' checked' : ''}" onclick="toggleDone('${r.id}')" aria-label="Concluir"></button>
      <div class="reminder-body">
        <div class="reminder-top">
          <span class="priority-dot" style="background:${pcol}" title="Prioridade ${r.priority}"></span>
          <span class="reminder-title">${escHtml(r.title)}</span>
          <span class="cat-badge" style="background:${col}22;color:${col}">${r.cat}</span>
        </div>
        <div class="reminder-meta">
          <span class="reminder-time${ov ? ' overdue' : ''}">
            <i class="ti ti-calendar"></i>${fmt}${ov ? ' · Atrasado' : ''}
          </span>
          ${r.repeat !== 'none' ? `<span class="repeat-tag"><i class="ti ti-refresh"></i>${REPEAT_LABEL[r.repeat]}</span>` : ''}
          ${r.desc ? `<span class="reminder-time"><i class="ti ti-align-left"></i>${escHtml(r.desc.slice(0,30))}${r.desc.length > 30 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      <div class="reminder-actions">
        <button class="icon-btn" onclick="editReminder('${r.id}')" aria-label="Editar"><i class="ti ti-edit"></i></button>
        <button class="icon-btn danger" onclick="deleteReminder('${r.id}')" aria-label="Excluir"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showLoading(v) {
  document.getElementById('loading-indicator').style.display = v ? 'block' : 'none';
}

// =====================================================
//  VIEW / FILTER
// =====================================================

function setView(v, el) {
  currentView = v;
  const titles = { all:'Todos os lembretes', today:'Lembretes de hoje', upcoming:'Próximos lembretes', done:'Lembretes concluídos' };
  document.getElementById('view-title').textContent = titles[v] || (v.startsWith('cat:') ? v.slice(4) : 'Lembretes');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  renderList();
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

// =====================================================
//  CRUD ACTIONS
// =====================================================

async function toggleDone(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  r.done = !r.done;
  renderList();
  await updateReminder(r);
  // Cancela notificação pendente se marcou como feito
  if (r.done && swReg?.active) {
    swReg.active.postMessage({ type: 'CANCEL', id: r.id });
  }
}

async function deleteReminder(id) {
  reminders = reminders.filter(x => x.id !== id);
  renderList();
  if (swReg?.active) swReg.active.postMessage({ type: 'CANCEL', id });
  await deleteReminderDb(id);
}

// =====================================================
//  MODAL
// =====================================================

function openModal() {
  editingId = null;
  document.getElementById('modal-heading').textContent = 'Novo lembrete';
  document.getElementById('f-title').value    = '';
  document.getElementById('f-desc').value     = '';
  document.getElementById('f-date').value     = getToday();
  document.getElementById('f-time').value     = '09:00';
  document.getElementById('f-cat').value      = 'Pessoal';
  document.getElementById('f-priority').value = 'normal';
  document.getElementById('f-repeat').value   = 'none';
  document.getElementById('f-advance').value  = '0';
  document.getElementById('f-repeat-end').value = '';
  selectedSound = 'padrão';
  updateSoundChips();
  toggleWeekdays();
  setTab('detalhes', document.querySelectorAll('.tab')[0]);
  document.getElementById('modal-overlay').classList.add('show');
}

function editReminder(id) {
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  document.getElementById('modal-heading').textContent = 'Editar lembrete';
  document.getElementById('f-title').value    = r.title;
  document.getElementById('f-desc').value     = r.desc;
  document.getElementById('f-date').value     = r.date;
  document.getElementById('f-time').value     = r.time;
  document.getElementById('f-cat').value      = r.cat;
  document.getElementById('f-priority').value = r.priority;
  document.getElementById('f-repeat').value   = r.repeat;
  document.getElementById('f-advance').value  = r.advance;
  document.getElementById('f-repeat-end').value = r.repeatEnd || '';
  selectedSound = r.sound;
  updateSoundChips();
  toggleWeekdays();
  setTab('detalhes', document.querySelectorAll('.tab')[0]);
  document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('show'); }

async function saveReminder() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;

  const local = {
    id:        editingId,
    title,
    desc:      document.getElementById('f-desc').value.trim(),
    date:      document.getElementById('f-date').value,
    time:      document.getElementById('f-time').value,
    cat:       document.getElementById('f-cat').value,
    priority:  document.getElementById('f-priority').value,
    repeat:    document.getElementById('f-repeat').value,
    sound:     selectedSound,
    advance:   parseInt(document.getElementById('f-advance').value),
    repeatEnd: document.getElementById('f-repeat-end').value,
    done:      false,
  };

  if (editingId) {
    const idx = reminders.findIndex(x => x.id === editingId);
    reminders[idx] = local;
    await updateReminder(local);
    showToast('Lembrete atualizado', local.title);
    scheduleNotification(local);
  } else {
    const saved = await insertReminder(local);
    if (saved) {
      reminders.push(saved);
      scheduleNotification(saved);
      showToast('Lembrete criado', saved.title);
    }
  }

  btn.disabled = false;
  closeModal();
  renderList();
}

// =====================================================
//  TABS DO MODAL
// =====================================================

function setTab(t, el) {
  ['detalhes','repeticao','som'].forEach(n => {
    document.getElementById('tab-' + n).style.display = n === t ? 'block' : 'none';
  });
  document.querySelectorAll('.tab').forEach(e => e.classList.remove('active'));
  if (el) el.classList.add('active');
}

function toggleWeekdays() {
  const v = document.getElementById('f-repeat').value;
  document.getElementById('f-weekdays-group').style.display = v === 'weekly' ? 'block' : 'none';
}

function selectSound(s, el) {
  selectedSound = s;
  updateSoundChips();
}

function updateSoundChips() {
  document.querySelectorAll('.sound-chip').forEach(el => {
    el.classList.toggle('active', el.textContent.toLowerCase() === selectedSound);
  });
}

// =====================================================
//  NOTIFICAÇÕES PUSH via Service Worker
// =====================================================

function checkPermBanner() {
  if (!('Notification' in window)) return;
  document.getElementById('perm-banner').style.display =
    Notification.permission === 'default' ? 'flex' : 'none';
}

async function requestNotifPerm() {
  const perm = await Notification.requestPermission();
  document.getElementById('perm-banner').style.display = 'none';
  if (perm === 'granted') {
    showToast('Notificações ativas!', 'Você receberá alertas nos seus lembretes.');
    await registerSW();
    scheduleAllNotifications();
  }
}

function scheduleAllNotifications() {
  reminders.forEach(r => scheduleNotification(r));
}

function scheduleNotification(r) {
  if (r.done || !r.date || !r.time) return;

  const dt      = new Date(r.date + 'T' + r.time);
  const trigger = new Date(dt.getTime() - r.advance * 60000);
  const delay   = trigger - Date.now();

  if (delay <= 0) return;

  // Envia para o Service Worker (funciona em background)
  if (swReg?.active && Notification.permission === 'granted') {
    swReg.active.postMessage({
      type: 'SCHEDULE',
      id:    r.id,
      title: r.title,
      body:  r.desc || 'Hora do seu lembrete!',
      delay
    });
  }

  // Fallback: setTimeout + som (funciona apenas com aba aberta)
  setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('RemindMe: ' + r.title, {
        body: r.desc || 'Hora do seu lembrete!',
        icon: '/public/icons/icon-192.png',
        tag:  'reminder-' + r.id,
      });
    }
    showToast('🔔 ' + r.title, r.desc || 'Hora do seu lembrete!');
    playSound(r.sound);
  }, Math.max(delay, 0));
}

function playSound(type) {
  if (type === 'silencioso') return;
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freqs = { padrão:[520,440,480], suave:[360,320,340], urgente:[880,660,880,660] };
    const seq   = freqs[type] || freqs['padrão'];
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + seq.length * 0.2);
    seq.forEach((f, i) => osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.18));
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + seq.length * 0.18 + 0.15);
  } catch(e) {}
}

// =====================================================
//  TOAST
// =====================================================

let toastTimer;
function showToast(title, body) {
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-body').textContent  = body;
  const t = document.getElementById('toast');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}
function closeToast() { document.getElementById('toast').classList.remove('show'); }

// Init SW ao carregar
registerSW();
