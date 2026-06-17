// =====================================================
//  APP — Lembretes com Supabase CRUD + Notificações
// =====================================================

const CAT_COLORS  = { Trabalho:'#c9c6ff', Saúde:'#8fd9a8', Pessoal:'#ffb454', Financeiro:'#ff8a80', Estudos:'#9ad1ff' };
const PRI_COLORS  = { normal:'#84828c', alta:'#ffb454', urgente:'#ff8a80' };
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

async function loadReminders(retryCount = 0) {
  showLoading(true);
  try {
    if (!currentUser?.id) throw new Error('currentUser ausente em loadReminders');

    const { data, error } = await sb
      .from('reminders')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('reminder_at', { ascending: true });

    if (error) throw error;

    reminders = (data || []).map(dbToLocal);
    renderList();
    scheduleAllNotifications();
    startAutoCheck();
    showLoading(false);
  } catch (e) {
    console.error('Erro ao carregar lembretes (tentativa ' + (retryCount + 1) + '):', e);

    // Retry automático — alguns navegadores (Edge Tracking Prevention) bloqueiam
    // o primeiro fetch logo após o load, mas liberam em seguida
    if (retryCount < 2) {
      setTimeout(() => loadReminders(retryCount + 1), 1200 * (retryCount + 1));
      return;
    }

    // Esgotou as tentativas — mostra erro com botão de retry manual
    showLoading(false);
    showLoadError();
  }
}

function showLoadError() {
  const el = document.getElementById('reminders-list');
  el.innerHTML = `
    <div class="empty">
      <i class="ti ti-wifi-off"></i>
      <div>Não foi possível carregar seus lembretes</div>
      <div style="font-size:12px;margin-top:6px;margin-bottom:16px">
        Seu navegador pode estar bloqueando a conexão (ex: Prevenção de Rastreamento do Edge).
      </div>
      <button class="btn btn-primary" onclick="retryLoadReminders()">
        <i class="ti ti-refresh"></i> Tentar de novo
      </button>
    </div>`;
}

function retryLoadReminders() {
  loadReminders(0);
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

// Formata data/hora em hora local (evita shift de fuso UTC)
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function localTimeStr(d) {
  const h = String(d.getHours()).padStart(2,'0');
  const min = String(d.getMinutes()).padStart(2,'0');
  return `${h}:${min}`;
}

function localToDb(r) {
  // Constrói a data no fuso local (evita conversão automática para UTC)
  let dt = null;
  if (r.date && r.time) {
    const [year, month, day] = r.date.split('-').map(Number);
    const [hour, min] = r.time.split(':').map(Number);
    const d = new Date(year, month - 1, day, hour, min, 0);
    dt = d.toISOString(); // armazena como UTC correto a partir da hora local
  }
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
    date:      dt ? localDateStr(dt) : '',  // hora local, não UTC
    time:      dt ? localTimeStr(dt) : '',  // hora local, não UTC
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
    await scheduleNextOccurrence(r, 'completed');
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
          <span class="cat-badge" style="background:${col}14;color:${col};border-color:${col}33">${escHtml(r.cat)}</span>
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

// =====================================================
//  SIDEBAR COLAPSÁVEL
// =====================================================

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('nexo-sidebar-collapsed', sidebar.classList.contains('collapsed') ? '1' : '0');
}

function restoreSidebarState() {
  if (localStorage.getItem('nexo-sidebar-collapsed') === '1') {
    document.getElementById('sidebar').classList.add('collapsed');
  }
}

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
    if (r.repeat !== 'none') {
      await scheduleNextOccurrence(r, 'completed');
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
  renderCustomSounds();
  toggleWeekdays();
  setTab('detalhes', document.querySelectorAll('.tab')[0]);
  document.getElementById('modal-overlay').classList.add('show');
  loadCustomSounds();
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
  renderCustomSounds();
  toggleWeekdays();
  // Restaura dias da semana marcados
  document.querySelectorAll('#f-weekdays-group input[type=checkbox]').forEach(cb => {
    cb.checked = (r.weekdays || []).includes(parseInt(cb.value));
  });
  setTab('detalhes', document.querySelectorAll('.tab')[0]);
  document.getElementById('modal-overlay').classList.add('show');
  loadCustomSounds();
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
  playSound(s, 1); // toca prévia uma única vez

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
//  SONS PERSONALIZADOS — upload, listagem, seleção, remoção
// =====================================================
const CUSTOM_SOUND_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const CUSTOM_SOUND_MAX_COUNT = 3;
let customSounds = []; // [{ id, name, url, path }]

async function loadCustomSounds() {
  try {
    const { data, error } = await sb.storage.from('custom-sounds').list(currentUser.id, {
      sortBy: { column: 'created_at', order: 'asc' }
    });
    if (error) throw error;

    customSounds = (data || []).map(f => {
      const path = `${currentUser.id}/${f.name}`;
      const { data: urlData } = sb.storage.from('custom-sounds').getPublicUrl(path);
      return {
        id:   f.name,
        name: f.name.replace(/^\d+-/, '').replace(/\.[^.]+$/, ''),
        url:  urlData.publicUrl,
        path: path,
      };
    });
  } catch (e) {
    console.error('Erro ao carregar sons personalizados:', e);
    customSounds = [];
  }
  renderCustomSounds();
}

function renderCustomSounds() {
  const el = document.getElementById('custom-sounds-list');
  if (!el) return;

  const uploadBtn = document.getElementById('upload-sound-btn');
  if (uploadBtn) uploadBtn.style.display = customSounds.length >= CUSTOM_SOUND_MAX_COUNT ? 'none' : 'inline-flex';

  if (!customSounds.length) {
    el.innerHTML = `<div style="font-size:12px;color:var(--text3);grid-column:1/-1">Nenhum som personalizado ainda.</div>`;
    updateSoundChips();
    return;
  }

  el.innerHTML = customSounds.map(s => {
    const value = `custom:${s.id}|${s.url}`;
    return `
      <div class="sound-chip" data-sound="${escHtml(value)}" style="position:relative;padding-right:26px" onclick="selectSound('${escHtml(value)}', this)">
        🎧 ${escHtml(s.name.slice(0,12))}${s.name.length > 12 ? '…' : ''}
        <span onclick="event.stopPropagation(); deleteCustomSound('${escHtml(s.path)}')"
          style="position:absolute;top:2px;right:2px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;color:var(--text3);cursor:pointer;font-size:11px"
          title="Remover som" aria-label="Remover som">
          <i class="ti ti-x"></i>
        </span>
      </div>`;
  }).join('');

  updateSoundChips();
}

async function handleSoundUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusEl = document.getElementById('sound-upload-status');
  statusEl.style.display = 'block';

  if (!file.type.startsWith('audio/')) {
    statusEl.textContent = 'Selecione apenas arquivos de áudio.';
    statusEl.style.color = 'var(--danger)';
    event.target.value = '';
    return;
  }

  if (file.size > CUSTOM_SOUND_MAX_BYTES) {
    const sizeMb = (file.size / (1024*1024)).toFixed(1);
    statusEl.textContent = `Arquivo muito grande (${sizeMb}MB). Máximo permitido: 5MB.`;
    statusEl.style.color = 'var(--danger)';
    event.target.value = '';
    return;
  }

  if (customSounds.length >= CUSTOM_SOUND_MAX_COUNT) {
    statusEl.textContent = `Você já tem ${CUSTOM_SOUND_MAX_COUNT} sons salvos. Remova um para enviar outro.`;
    statusEl.style.color = 'var(--danger)';
    event.target.value = '';
    return;
  }

  statusEl.textContent = 'Enviando...';
  statusEl.style.color = 'var(--text2)';

  try {
    const ext      = file.name.split('.').pop().toLowerCase();
    const safeName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().slice(0, 30) || 'som';
    const filePath = `${currentUser.id}/${Date.now()}-${safeName}.${ext}`;

    const { error: uploadError } = await sb.storage
      .from('custom-sounds')
      .upload(filePath, file, { upsert: false, cacheControl: '3600' });

    if (uploadError) throw uploadError;

    statusEl.textContent = '✓ Som adicionado!';
    statusEl.style.color = 'var(--success)';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);

    await loadCustomSounds();
  } catch (e) {
    console.error('Erro ao enviar som:', e);
    statusEl.textContent = 'Erro ao enviar arquivo. Tente novamente.';
    statusEl.style.color = 'var(--danger)';
  } finally {
    event.target.value = '';
  }
}

async function deleteCustomSound(path) {
  try {
    const { error } = await sb.storage.from('custom-sounds').remove([path]);
    if (error) throw error;

    // Se o som excluído estava selecionado, volta para o padrão
    if (selectedSound.includes(path.split('/').pop())) {
      selectedSound = 'padrão';
    }

    await loadCustomSounds();
    showToast('Som removido', 'O som personalizado foi excluído.');
  } catch (e) {
    console.error('Erro ao remover som:', e);
    showToast('Erro', 'Não foi possível remover o som.');
  }
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

async function scheduleNextOccurrence(r, status = 'fired') {
  // Grava o disparo atual no histórico
  await insertLog(r.id, status);

  // Calcula próxima data
  const next = getNextOccurrenceDate(r);
  if (!next) return;

  // Atualiza o MESMO lembrete com a próxima data (não cria novo)
  const updated = {
    ...r,
    date: localDateStr(next),
    time: localTimeStr(next),
    done: false,
  };

  const idx = reminders.findIndex(x => x.id === r.id);
  if (idx !== -1) reminders[idx] = updated;

  await updateReminder(updated);
  scheduleNotification(updated);
  renderList();
}

function clearNotifTimers(id) {
  if (notifTimers[id]) {
    notifTimers[id].forEach(t => clearTimeout(t));
    delete notifTimers[id];
  }
  if (swReg?.active) swReg.active.postMessage({ type: 'CANCEL', id });
}

function fireAlert(r, label) {
  const body = label
    ? `⏰ ${label}: ${r.desc || r.title}`
    : r.desc || 'Hora do seu lembrete!';

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Nexo: ' + r.title, {
        body, icon:'/public/icons/icon-192.png',
        tag:'reminder-' + r.id + (label||''), requireInteraction: true
      });
    } catch(e) {}
  }

  showInAppNotif(r.id, r.title, body);
  playSound(r.sound);
}

function scheduleNotification(r) {
  // Sempre limpa timers antigos primeiro — evita duplicar notificação ao editar
  clearNotifTimers(r.id);

  if (r.done || !r.date || !r.time) return;

  const dt    = new Date(r.date + 'T' + r.time);
  const now   = Date.now();
  const ids   = [];

  // Alerta de antecedência (se advance > 0)
  if (r.advance > 0) {
    const advanceDelay = dt.getTime() - r.advance * 60000 - now;
    if (advanceDelay > 0) {
      const advLabel = r.advance >= 60
        ? `${r.advance / 60}h antes`
        : `${r.advance}min antes`;
      ids.push(setTimeout(() => fireAlert(r, advLabel), advanceDelay));
    }
  }

  // Alerta no horário exato (sempre)
  const onTimeDelay = dt.getTime() - now;
  if (onTimeDelay > 0) {
    ids.push(setTimeout(() => {
      fireAlert(r, null);
      delete notifTimers[r.id];
      scheduleNextOccurrence(r); // recria próxima ocorrência se repetitivo
    }, onTimeDelay));
  }

  if (ids.length) notifTimers[r.id] = ids;
}

function playSound(type, repeat = 3) {
  if (type === 'silencioso') return;

  // Sons personalizados — formato "custom:<id>|<url>"
  if (type && type.startsWith('custom:')) {
    return playCustomSound(type, repeat);
  }

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

function playCustomSound(type, repeat = 3) {
  const url = type.split('|')[1];
  if (!url) return;

  let playCount = 0;
  const play = () => {
    if (playCount >= repeat) return;
    playCount++;
    const audio = new Audio(url);
    audio.volume = 0.8;
    audio.addEventListener('ended', () => {
      if (playCount < repeat) setTimeout(play, 300);
    });
    audio.play().catch(e => console.error('Erro ao tocar som personalizado:', e));
  };
  play();
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

// =====================================================
//  REMINDER LOGS — histórico de disparos
// =====================================================

let currentHistoryReminderId = null;

// --- DB ---
async function insertLog(reminderId, status = 'fired', note = '', firedAt = null) {
  try {
    const { error } = await sb.from('reminder_logs').insert([{
      reminder_id: reminderId,
      user_id:     currentUser.id,
      fired_at:    firedAt || new Date().toISOString(),
      status,
      note:        note || null,
    }]);
    if (error) console.error('Erro ao gravar log:', error);
  } catch (e) {
    console.error('Erro ao gravar log:', e);
  }
}

async function fetchLogs(reminderId) {
  try {
    const { data, error } = await sb
      .from('reminder_logs')
      .select('*')
      .eq('reminder_id', reminderId)
      .order('fired_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('Erro ao buscar logs:', e);
    return [];
  }
}

async function deleteLog(logId) {
  try {
    const { error } = await sb.from('reminder_logs').delete()
      .eq('id', logId).eq('user_id', currentUser.id);
    if (error) throw error;
  } catch (e) {
    console.error('Erro ao excluir log:', e);
  }
}

// --- Modal ---
function openHistoryModal(reminderId) {
  const r = reminders.find(x => x.id === reminderId);
  if (!r) return;

  currentHistoryReminderId = reminderId;

  document.getElementById('history-modal-title').textContent = r.title;
  document.getElementById('history-modal-sub').textContent =
    `${REPEAT_LABEL[r.repeat] || r.repeat} · ${r.cat}`;

  // Pré-preenche data/hora com o próximo disparo esperado
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const dtLocal = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  document.getElementById('log-datetime').value = dtLocal;
  document.getElementById('log-note').value = '';
  document.getElementById('log-status').value = 'fired';

  document.getElementById('history-modal').classList.add('show');
  loadHistoryList(reminderId);
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.remove('show');
  currentHistoryReminderId = null;
}

async function loadHistoryList(reminderId) {
  const el = document.getElementById('history-list');
  el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--paper-3);font-size:13px">
    <i class="ti ti-loader" style="font-size:24px;display:block;margin-bottom:8px;animation:spin 1s linear infinite"></i>
    Carregando...
  </div>`;

  const logs = await fetchLogs(reminderId);

  if (!logs.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--paper-3);font-size:13px">
      <i class="ti ti-history" style="font-size:28px;display:block;margin-bottom:8px"></i>
      Nenhum disparo registrado ainda.
    </div>`;
    return;
  }

  const STATUS_CONFIG = {
    completed: { icon: 'ti-circle-check',  color: 'var(--ok)',     label: 'Concluído' },
    snoozed:   { icon: 'ti-clock',         color: 'var(--signal)', label: 'Adiado'    },
    ignored:   { icon: 'ti-circle-x',      color: 'var(--err)',    label: 'Ignorado'  },
    fired:     { icon: 'ti-bell',          color: 'var(--paper-2)',label: 'Disparado' },
  };

  el.innerHTML = logs.map(log => {
    const dt   = new Date(log.fired_at);
    const date = dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
    const time = localTimeStr(dt);
    const cfg  = STATUS_CONFIG[log.status] || STATUS_CONFIG.fired;

    return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;background:var(--ink-2);border:1px solid var(--line);border-radius:var(--radius-sm)">
      <i class="ti ${cfg.icon}" style="font-size:18px;color:${cfg.color};flex-shrink:0;margin-top:1px"></i>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${log.note ? '4px' : '0'}">
          <span style="font-size:13px;font-weight:500;color:var(--paper-0)">${escHtml(date)} às ${escHtml(time)}</span>
          <span style="font-size:11px;font-weight:600;color:${cfg.color};background:${cfg.color}18;padding:2px 8px;border-radius:20px">${cfg.label}</span>
        </div>
        ${log.note ? `<div style="font-size:12px;color:var(--paper-2)">${escHtml(log.note)}</div>` : ''}
      </div>
      <button class="icon-btn danger" onclick="removeLogEntry('${log.id}')" aria-label="Remover entrada" title="Remover">
        <i class="ti ti-trash" style="font-size:14px"></i>
      </button>
    </div>`;
  }).join('');
}

async function addLogEntry() {
  if (!currentHistoryReminderId) return;

  const status   = document.getElementById('log-status').value;
  const note     = document.getElementById('log-note').value.trim();
  const dtInput  = document.getElementById('log-datetime').value;
  const firedAt  = dtInput ? new Date(dtInput).toISOString() : new Date().toISOString();

  const btn = document.getElementById('add-log-btn');
  btn.disabled = true;

  await insertLog(currentHistoryReminderId, status, note, firedAt);

  btn.disabled = false;
  document.getElementById('log-note').value = '';
  await loadHistoryList(currentHistoryReminderId);
}

async function removeLogEntry(logId) {
  await deleteLog(logId);
  if (currentHistoryReminderId) {
    await loadHistoryList(currentHistoryReminderId);
  }
}

// =====================================================
//  ENTER PARA SUBMETER — mapeia campos a botões de ação
// =====================================================

const ENTER_SUBMIT_MAP = {
  'login-password':         () => loginEmail(),
  'login-email':            () => document.getElementById('login-password')?.focus(),
  'reg-password':           () => registerEmail(),
  'reg-email':              () => document.getElementById('reg-password')?.focus(),
  'reg-name':               () => document.getElementById('reg-email')?.focus(),
  'reset-password-input2':  () => saveNewPassword(),
  'reset-password-input':   () => document.getElementById('reset-password-input2')?.focus(),
  'complete-password2':     () => saveCompleteProfile(),
  'complete-password':      () => document.getElementById('complete-password2')?.focus(),
  'profile-new-password2':  () => saveProfilePassword(),
  'profile-new-password':   () => document.getElementById('profile-new-password2')?.focus(),
  'profile-name-input':     () => saveProfileName(),
};

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const id = e.target?.id;
  if (!id || !(id in ENTER_SUBMIT_MAP)) return;

  // Evita submit de <form> nativo / quebra de linha em textarea
  e.preventDefault();
  ENTER_SUBMIT_MAP[id]();
});


















