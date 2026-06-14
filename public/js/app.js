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
    weekdays:     r.weekdays && r.weekdays.length ? r.weekdays : null,
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
    weekdays:  row.weekdays || [],
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
    if (snoozedIds.has(r.id)) continue; // está adiado, não marcar como feito
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
  clearNotifTimers(r.id);

  if (r.repeat !== 'none') {
    await scheduleNextOccurrence(r);
  }

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
  const total   = reminders.length;
  const today   = reminders.filter(r => isToday(r) && !r.done).length;
  const late    = reminders.filter(r => isOverdue(r)).length;
  const done    = reminders.filter(r => r.done).length;

  document.getElementById('s-total').textContent = total;
  document.getElementById('s-today').textContent = today;
  document.getElementById('s-late').textContent  = late;
  document.getElementById('s-done').textContent  = done;
  document.getElementById('badge-all').textContent   = reminders.filter(r => !r.done).length;
  document.getElementById('badge-today').textContent = today;

  // Destaque visual no card de atrasados
  const lateCard = document.getElementById('s-late').closest('.stat-card');
  lateCard.classList.toggle('has-overdue', late > 0);
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
  const hasSearch = document.getElementById('search-input').value.trim().length > 0;

  if (!list.length) {
    if (hasSearch) {
      el.innerHTML = `<div class="empty"><i class="ti ti-search-off"></i><div>Nenhum resultado para sua busca</div><div style="font-size:12px;margin-top:6px">Tente outro termo ou limpe o filtro</div></div>`;
    } else if (reminders.length === 0) {
      el.innerHTML = `<div class="empty"><i class="ti ti-mood-empty"></i><div>Você ainda não tem lembretes</div><div style="font-size:12px;margin-top:6px">Clique em "Novo lembrete" para criar o primeiro</div></div>`;
    } else {
      el.innerHTML = `<div class="empty"><i class="ti ti-filter-off"></i><div>Nada por aqui</div><div style="font-size:12px;margin-top:6px">Nenhum lembrete corresponde a este filtro</div></div>`;
    }
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
          <span class="cat-badge" style="background:${col}22;color:${col}">${escHtml(r.cat)}</span>
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
  const indicator = document.getElementById('loading-indicator');
  const list = document.getElementById('reminders-list');
  if (v) {
    indicator.style.display = 'none';
    list.innerHTML = Array.from({length: 4}).map(() => `
      <div class="skeleton-card">
        <div class="skeleton-circle skeleton-shimmer"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line short skeleton-shimmer"></div>
          <div class="skeleton-line long skeleton-shimmer"></div>
        </div>
      </div>`).join('');
  } else {
    indicator.style.display = 'none';
  }
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

  if (r.done) {
    clearNotifTimers(r.id);
    // Se for repetitivo, cria a próxima ocorrência
    if (r.repeat !== 'none') {
      await scheduleNextOccurrence(r);
    }
  }
}

async function deleteReminder(id) {
  reminders = reminders.filter(x => x.id !== id);
  renderList();
  clearNotifTimers(id);
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
  document.querySelectorAll('#f-weekdays-group input[type=checkbox]').forEach(cb => cb.checked = false);
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
  // Restaura dias da semana marcados
  document.querySelectorAll('#f-weekdays-group input[type=checkbox]').forEach(cb => {
    cb.checked = (r.weekdays || []).includes(parseInt(cb.value));
  });
  setTab('detalhes', document.querySelectorAll('.tab')[0]);
  document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('show'); }

async function saveReminder() {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { document.getElementById('f-title').focus(); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;

  // Validação: data e hora obrigatórias
  const dateVal = document.getElementById('f-date').value;
  const timeVal = document.getElementById('f-time').value;
  if (!dateVal || !timeVal) {
    showToast('Data e hora obrigatórias', 'Preencha data e hora para o lembrete funcionar corretamente.');
    document.getElementById('save-btn').disabled = false;
    return;
  }

  // Lê dias da semana selecionados (repetição semanal)
  const weekdays = Array.from(document.querySelectorAll('#f-weekdays-group input[type=checkbox]:checked'))
    .map(cb => parseInt(cb.value));

  const local = {
    id:        editingId,
    title,
    desc:      document.getElementById('f-desc').value.trim(),
    date:      dateVal,
    time:      timeVal,
    cat:       document.getElementById('f-cat').value,
    priority:  document.getElementById('f-priority').value,
    repeat:    document.getElementById('f-repeat').value,
    weekdays:  weekdays,
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
  playSound(s); // toca prévia imediatamente

  if (el) {
    el.classList.remove('playing');
    requestAnimationFrame(() => {
      el.classList.add('playing');
      setTimeout(() => el.classList.remove('playing'), 500);
    });
  }
}

function updateSoundChips() {
  document.querySelectorAll('.sound-chip').forEach(el => {
    const val = el.dataset.sound;
    el.classList.toggle('active', val === selectedSound);
  });
}

// =====================================================
//  SONS — definições completas
// =====================================================
const SOUNDS = {
  padrão: {
    label: '🔔 Padrão',
    play: (ctx) => {
      const seq = [520, 440, 480];
      playTones(ctx, seq, 0.18, 0.3);
    }
  },
  suave: {
    label: '🎵 Suave',
    play: (ctx) => {
      const seq = [360, 380, 400, 380];
      playTones(ctx, seq, 0.22, 0.18, 'sine');
    }
  },
  urgente: {
    label: '🚨 Urgente',
    play: (ctx) => {
      const seq = [880, 660, 880, 660, 880];
      playTones(ctx, seq, 0.12, 0.4, 'square');
    }
  },
  campanha: {
    label: '🔕 Campainha',
    play: (ctx) => {
      const seq = [600, 550, 600, 550, 600, 800];
      playTones(ctx, seq, 0.14, 0.25, 'triangle');
    }
  },
  digital: {
    label: '💻 Digital',
    play: (ctx) => {
      const seq = [1000, 800, 1000];
      playTones(ctx, seq, 0.1, 0.35, 'square');
    }
  },
  melodia: {
    label: '🎶 Melodia',
    play: (ctx) => {
      const seq = [523, 587, 659, 698, 784, 880];
      playTones(ctx, seq, 0.16, 0.22, 'sine');
    }
  },
  ping: {
    label: '📍 Ping',
    play: (ctx) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.type = 'sine';
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    }
  },
  silencioso: {
    label: '🔇 Silencioso',
    play: () => {} // sem som
  }
};

function playTones(ctx, freqs, step, vol, type = 'triangle') {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = type;
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + freqs.length * step + 0.1);
  freqs.forEach((f, i) => osc.frequency.setValueAtTime(f, ctx.currentTime + i * step));
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + freqs.length * step + 0.15);
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

// =====================================================
//  IN-APP NOTIFICATION — garante entrega em qualquer máquina
// =====================================================

let inappCurrentId = null;
let inappAutoClose = null;
const snoozedIds = new Set(); // IDs adiados — não marcar como feito automaticamente
const notifTimers = {}; // id -> [timeoutId, ...] para poder cancelar

function showInAppNotif(id, title, body) {
  inappCurrentId = id;
  document.getElementById('inapp-title').textContent = title;
  document.getElementById('inapp-body').textContent  = body;

  const panel = document.getElementById('inapp-notif');
  panel.classList.remove('hiding');
  panel.style.display = 'block';

  // Barra de progresso — fecha automaticamente em 12s
  const bar = document.getElementById('inapp-progress');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  clearTimeout(inappAutoClose);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.transition = 'width 12s linear';
    bar.style.width = '0%';
  }));

  inappAutoClose = setTimeout(() => closeInAppNotif(), 12000);
}

function closeInAppNotif() {
  clearTimeout(inappAutoClose);
  const panel = document.getElementById('inapp-notif');
  panel.classList.add('hiding');
  setTimeout(() => { panel.style.display = 'none'; panel.classList.remove('hiding'); }, 300);
  inappCurrentId = null;
}

async function inappMarkDone() {
  if (inappCurrentId) await toggleDone(inappCurrentId);
  closeInAppNotif();
}

function inappSnooze() {
  // Salva referências ANTES de fechar (closeInAppNotif limpa inappCurrentId)
  const savedId = inappCurrentId;
  const r = reminders.find(x => x.id === savedId);
  closeInAppNotif();
  if (!r) { showToast('Erro', 'Lembrete não encontrado.'); return; }

  const delay = 10 * 60 * 1000; // 10 minutos

  // Protege o lembrete do auto-check durante o snooze
  snoozedIds.add(r.id);

  setTimeout(() => {
    snoozedIds.delete(r.id); // libera proteção
    showInAppNotif(r.id, r.title, r.desc || 'Hora do seu lembrete!');
    playSound(r.sound);
  }, delay);

  showToast('⏰ Adiado por 10 minutos', r.title);
}

// =====================================================
//  REPETIÇÃO — calcula próxima ocorrência e recria lembrete
// =====================================================

function getNextOccurrenceDate(r) {
  const cur = new Date(r.date + 'T' + r.time);
  let next  = new Date(cur);

  if (r.repeat === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (r.repeat === 'weekly') {
    if (r.weekdays && r.weekdays.length) {
      // Encontra o próximo dia da semana marcado
      for (let i = 1; i <= 7; i++) {
        const candidate = new Date(cur);
        candidate.setDate(candidate.getDate() + i);
        if (r.weekdays.includes(candidate.getDay())) { next = candidate; break; }
      }
    } else {
      next.setDate(next.getDate() + 7);
    }
  } else if (r.repeat === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else {
    return null; // não repete
  }

  // Respeita data limite de repetição
  if (r.repeatEnd) {
    const limit = new Date(r.repeatEnd + 'T23:59');
    if (next > limit) return null;
  }

  return next;
}

async function scheduleNextOccurrence(r) {
  const next = getNextOccurrenceDate(r);
  if (!next) return;

  const nextLocal = {
    ...r,
    id:   null, // novo registro
    date: next.toISOString().slice(0,10),
    time: next.toTimeString().slice(0,5),
    done: false,
  };

  const saved = await insertReminder(nextLocal);
  if (saved) {
    reminders.push(saved);
    scheduleNotification(saved);
    renderList();
  }
}

function clearNotifTimers(id) {
  if (notifTimers[id]) {
    notifTimers[id].forEach(t => clearTimeout(t));
    delete notifTimers[id];
  }
  if (swReg?.active) swReg.active.postMessage({ type: 'CANCEL', id });
}

function scheduleNotification(r) {
  // Sempre limpa timers antigos primeiro — evita duplicar notificação ao editar
  clearNotifTimers(r.id);

  if (r.done || !r.date || !r.time) return;

  const dt      = new Date(r.date + 'T' + r.time);
  const trigger = new Date(dt.getTime() - r.advance * 60000);
  const delay   = trigger - Date.now();

  if (delay <= 0) return;

  // 1. Service Worker — notificação nativa em background
  if (swReg?.active && Notification.permission === 'granted') {
    swReg.active.postMessage({ type:'SCHEDULE', id:r.id, title:r.title, body:r.desc||'Hora do seu lembrete!', delay });
  }

  // 2. setTimeout — garante disparo com aba aberta (independe de permissão)
  const timeoutId = setTimeout(() => {
    const body = r.desc || 'Hora do seu lembrete!';

    // Notificação nativa (se tiver permissão)
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Nexo: ' + r.title, {
          body, icon:'/public/icons/icon-192.png',
          tag:'reminder-' + r.id, requireInteraction: true
        });
      } catch(e) {}
    }

    // Painel in-app — SEMPRE dispara independente de permissão ou sistema
    showInAppNotif(r.id, r.title, body);

    // Som
    playSound(r.sound);

    // Limpa o registro após disparar
    delete notifTimers[r.id];

    // Se for repetitivo, agenda a próxima ocorrência
    scheduleNextOccurrence(r);
  }, Math.max(delay, 0));

  notifTimers[r.id] = [timeoutId];
}

function playSound(type, repeat = 3) {
  if (type === 'silencioso') return;
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)();
    const sound = SOUNDS[type] || SOUNDS['padrão'];
    // Calcula a duração de cada repetição com base no tipo
    const durations = { padrão:0.9, suave:1.1, urgente:0.8, campanha:1.1, digital:0.5, melodia:1.2, ping:0.7 };
    const dur = durations[type] || 1.0;
    const gap = 0.3; // pausa entre repetições

    for (let i = 0; i < repeat; i++) {
      const offset = i * (dur + gap);
      setTimeout(() => {
        try {
          const c = new (window.AudioContext || window.webkitAudioContext)();
          sound.play(c);
        } catch(e) {}
      }, offset * 1000);
    }
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







