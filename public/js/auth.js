// =====================================================
//  AUTH — Login, Registro, Google OAuth, Logout
// =====================================================

let currentUser = null;
let appInitialized = false; // evita showApp() duplo na inicialização

// --------------------------------------------------
//  INICIALIZAÇÃO — lê sessão do localStorage primeiro
//  antes de qualquer evento do onAuthStateChange
// --------------------------------------------------
// Timeout de segurança absoluto — garante que o loading nunca trave para sempre.
// NUNCA chama showAuth()/logout aqui: se a sessão já foi confirmada (currentUser setado),
// apenas esconde o loading e deixa showApp() terminar em background.
const bootSafetyTimeout = setTimeout(() => {
  if (!appInitialized) {
    console.warn('Boot demorou demais (>15s). Ocultando loading sem deslogar.');
    hideLoadingScreen();
    if (!currentUser) showAuth();
    appInitialized = true;
  }
}, 15000);

(async () => {
  // Garante que app.js já definiu suas funções (restoreSidebarState, loadReminders, etc)
  // antes de prosseguir — evita ReferenceError por ordem de carregamento de scripts.
  if (typeof restoreSidebarState !== 'function') {
    await new Promise(resolve => {
      const check = () => {
        if (typeof restoreSidebarState === 'function') resolve();
        else setTimeout(check, 10);
      };
      check();
    });
  }

  showLoadingScreen();

  let session = null;
  try {
    const result = await sb.auth.getSession();
    session = result?.data?.session || null;
  } catch (e) {
    console.error('Erro ao recuperar sessão:', e);
  }

  try {
    if (session?.user) {
      currentUser = session.user;
      await showApp();
    } else {
      showAuth();
    }
  } catch (e) {
    console.error('Erro ao montar tela inicial:', e);
    // Só volta para login se NÃO houver sessão válida —
    // erros de UI/rede após confirmar a sessão não devem deslogar
    if (!currentUser) showAuth();
  } finally {
    clearTimeout(bootSafetyTimeout);
    hideLoadingScreen();
    appInitialized = true;
  }

  // Agora sim escuta mudanças futuras (login, logout, refresh)
  sb.auth.onAuthStateChange(async (event, session) => {
    // Ignora o SIGNED_IN que o Supabase dispara durante a própria inicialização
    // (já tratado no bloco acima) — só processa eventos pós-boot
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      if (!appInitialized) return; // evita showApp() duplicado no boot
      await showApp();

      // Primeiro login com Google → abre painel de senha
      const provider  = currentUser.app_metadata?.provider || '';
      const createdAt = new Date(currentUser.created_at).getTime();
      const isNew     = (Date.now() - createdAt) < 30000;
      const hasPass   = currentUser.identities?.some(i => i.provider === 'email');
      if (provider === 'google' && isNew && !hasPass) {
        openCompleteProfileModal();
      }
    }

    if (event === 'PASSWORD_RECOVERY') {
      showAuth();
      openResetPasswordModal();
    }

    if (event === 'SIGNED_OUT') {
      currentUser = null;
      showAuth();
    }

    // TOKEN_REFRESHED — atualiza currentUser silenciosamente
    if (event === 'TOKEN_REFRESHED' && session?.user) {
      currentUser = session.user;
    }
  });
})();

// --------------------------------------------------
//  Loading screen
// --------------------------------------------------
function showLoadingScreen() {
  document.getElementById('loading-screen').style.display = 'flex';
  document.getElementById('auth-screen').style.display   = 'none';
  document.getElementById('app-screen').style.display    = 'none';
}

function hideLoadingScreen() {
  document.getElementById('loading-screen').style.display = 'none';
}

// --------------------------------------------------
//  Alternar tabs de login / registro
// --------------------------------------------------
function switchAuthTab(tab) {
  document.getElementById('tab-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  hideAuthError();
}

// --------------------------------------------------
//  Login com e-mail e senha
// --------------------------------------------------
async function loginEmail() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showAuthError('Preencha e-mail e senha.');

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message === 'Invalid login credentials')
      return showAuthError('E-mail ou senha incorretos. Se você entrou com Google antes, use "Continuar com Google".', 'warning');
    if (error.message === 'Email not confirmed')
      return showAuthError('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.', 'warning');
    return showAuthError(translateError(error.message));
  }
}

// --------------------------------------------------
//  Registro com e-mail e senha
// --------------------------------------------------
async function registerEmail() {
  const name     = document.getElementById('reg-name').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!name || !email || !password) return showAuthError('Preencha todos os campos.');
  if (!isValidEmail(email)) return showAuthError('Digite um e-mail válido.');
  if (password.length < 6)  return showAuthError('A senha precisa ter pelo menos 6 caracteres.');

  const btn = document.querySelector('#tab-register .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }

  const { error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name }, emailRedirectTo: window.location.origin }
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-user-plus"></i> Criar conta'; }

  if (error) {
    if (error.message === 'User already registered')
      return showAuthError('Este e-mail já está cadastrado. Tente entrar ou use "Continuar com Google".', 'warning');
    return showAuthError(translateError(error.message));
  }

  showAuthError('📧 E-mail de confirmação enviado! Verifique sua caixa de entrada e clique no link para ativar sua conta.', 'success');
}

// --------------------------------------------------
//  Login com Google
// --------------------------------------------------
async function loginGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showAuthError(translateError(error.message));
}

// --------------------------------------------------
//  Recuperar senha
// --------------------------------------------------
async function forgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email)               return showAuthError('Digite seu e-mail no campo acima.');
  if (!isValidEmail(email)) return showAuthError('Digite um e-mail válido.');

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });

  if (error) {
    if (error.message?.toLowerCase().includes('not found'))
      return showAuthError('Este e-mail está vinculado ao Google. Use "Continuar com Google".', 'warning');
    return showAuthError(translateError(error.message));
  }

  showAuthError('📧 Link de redefinição enviado para ' + email + '. Verifique sua caixa de entrada.', 'success');
}

// --------------------------------------------------
//  Modal de redefinição de senha
// --------------------------------------------------
function openResetPasswordModal() {
  document.getElementById('reset-password-modal').classList.add('show');
}

async function saveNewPassword() {
  const pass  = document.getElementById('reset-password-input').value;
  const pass2 = document.getElementById('reset-password-input2').value;

  if (!pass)           return showResetError('Digite uma nova senha.');
  if (pass.length < 6) return showResetError('A senha deve ter pelo menos 6 caracteres.');
  if (pass !== pass2)  return showResetError('As senhas não coincidem.');

  const btn = document.getElementById('reset-save-btn');
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: pass });
  btn.disabled = false;

  if (error) return showResetError('Erro ao salvar: ' + error.message);

  document.getElementById('reset-password-modal').classList.remove('show');
  showToast('✅ Senha redefinida!', 'Sua nova senha foi salva com sucesso.');
}

function showResetError(msg) {
  const el = document.getElementById('reset-password-error');
  el.textContent = msg; el.style.display = 'block';
  el.style.background  = 'rgba(226,75,74,0.12)';
  el.style.borderColor = 'var(--danger)';
  el.style.color       = 'var(--danger)';
}

// --------------------------------------------------
//  Logout
// --------------------------------------------------
async function logout() {
  // Confirma delete pendente (undo) antes de deslogar
  if (typeof undoState !== 'undefined' && undoState) {
    clearTimeout(undoState.timer);
    await deleteReminderDb(undoState.reminder.id);
    undoState = null;
  }

  // Limpa todos os timers de notificação pendentes antes de deslogar
  if (typeof notifTimers !== 'undefined') {
    Object.keys(notifTimers).forEach(id => clearNotifTimers(id));
  }
  if (typeof autoCheckInterval !== 'undefined' && autoCheckInterval) {
    clearInterval(autoCheckInterval);
  }
  reminders = [];

  await sb.auth.signOut();
  closeProfileModal();
}

// --------------------------------------------------
//  Mostrar / Esconder telas
// --------------------------------------------------
function showAuth() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
}

async function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'flex';

  const meta     = currentUser.user_metadata || {};
  const name     = meta.full_name || meta.name || currentUser.email.split('@')[0];
  const email    = currentUser.email;
  const provider = currentUser.app_metadata?.provider || '';
  const badge    = provider === 'google'
    ? '<span style="font-size:10px;background:#4285F420;color:#4285F4;padding:2px 7px;border-radius:20px;margin-left:6px">Google</span>'
    : '';

  applyAvatar(document.getElementById('user-avatar'), name, meta.avatar_url);
  document.getElementById('user-name').innerHTML        = name + badge;
  document.getElementById('user-email').textContent     = email;
  document.getElementById('profile-email').textContent  = email;

  restoreSidebarState();
  await loadReminders();
  checkPermBanner();
}

// --------------------------------------------------
//  Avatar — exibe foto de perfil ou iniciais
// --------------------------------------------------
function applyAvatar(el, name, avatarUrl) {
  if (!el) return;
  const initials = (name || '?').slice(0, 2).toUpperCase();
  if (avatarUrl) {
    el.innerHTML = `<img src="${avatarUrl}" alt="Foto de perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  } else {
    el.textContent = initials;
  }
}

// --------------------------------------------------
//  Completar perfil — Google first login
// --------------------------------------------------
function openCompleteProfileModal() {
  const meta     = currentUser.user_metadata || {};
  const name     = meta.full_name || meta.name || currentUser.email.split('@')[0];
  document.getElementById('complete-avatar').textContent = name.slice(0, 2).toUpperCase();
  document.getElementById('complete-name').textContent   = name;
  document.getElementById('complete-email').textContent  = currentUser.email;
  document.getElementById('complete-password').value     = '';
  document.getElementById('complete-password2').value    = '';
  document.getElementById('complete-profile-error').style.display = 'none';
  document.getElementById('complete-profile-modal').classList.add('show');
}

async function skipCompleteProfile() {
  await sb.auth.updateUser({ password: 'mudar123' });
  document.getElementById('complete-profile-modal').classList.remove('show');
  showToast('⚠️ Lembrete de segurança', 'Sua senha padrão é mudar123. Troque assim que possível!');
}

async function saveCompleteProfile() {
  const pass  = document.getElementById('complete-password').value;
  const pass2 = document.getElementById('complete-password2').value;
  if (!pass)           return showCompleteError('Digite uma senha.');
  if (pass.length < 6) return showCompleteError('A senha deve ter pelo menos 6 caracteres.');
  if (pass !== pass2)  return showCompleteError('As senhas não coincidem.');

  const btn = document.getElementById('complete-save-btn');
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: pass });
  btn.disabled = false;

  if (error) return showCompleteError('Erro ao salvar senha: ' + error.message);
  document.getElementById('complete-profile-modal').classList.remove('show');
  showToast('Senha criada!', 'Agora você pode entrar com e-mail e senha também.');
}

function showCompleteError(msg) {
  const el = document.getElementById('complete-profile-error');
  el.textContent = msg; el.style.display = 'block';
  el.style.background  = 'rgba(226,75,74,0.12)';
  el.style.borderColor = 'var(--danger)';
  el.style.color       = 'var(--danger)';
}

function togglePassVis(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  input.type = input.type === 'password' ? 'text' : 'password';
  icon.innerHTML = input.type === 'password' ? '<i class="ti ti-eye"></i>' : '<i class="ti ti-eye-off"></i>';
}

// --------------------------------------------------
//  Helpers
// --------------------------------------------------
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showAuthError(msg, type = 'error') {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = 'block';
  const s = {
    error:   { bg:'rgba(226,75,74,0.12)',  border:'var(--danger)',  color:'var(--danger)'  },
    warning: { bg:'rgba(245,166,35,0.12)', border:'var(--warning)', color:'var(--warning)' },
    success: { bg:'rgba(34,201,122,0.12)', border:'var(--success)', color:'var(--success)' },
  }[type] || {};
  el.style.background = s.bg; el.style.borderColor = s.border; el.style.color = s.color;
}

function hideAuthError() { document.getElementById('auth-error').style.display = 'none'; }

function translateError(msg) {
  return {
    'Invalid login credentials':               'E-mail ou senha incorretos.',
    'Email not confirmed':                     'Confirme seu e-mail antes de entrar.',
    'User already registered':                 'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters':'A senha deve ter ao menos 6 caracteres.',
    'Email rate limit exceeded':               'Muitas tentativas. Aguarde alguns minutos.',
  }[msg] || msg;
}

// --------------------------------------------------
//  Modal de perfil — abrir/fechar + popular campos
// --------------------------------------------------
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB

function openProfileModal() {
  const meta = currentUser.user_metadata || {};
  const name = meta.full_name || meta.name || currentUser.email.split('@')[0];

  applyAvatar(document.getElementById('profile-avatar'), name, meta.avatar_url);
  document.getElementById('profile-name-input').value = name;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-new-password').value  = '';
  document.getElementById('profile-new-password2').value = '';
  document.getElementById('profile-error').style.display = 'none';
  document.getElementById('avatar-upload-status').style.display = 'none';

  document.getElementById('profile-modal').classList.add('show');
}

function closeProfileModal() { document.getElementById('profile-modal').classList.remove('show'); }

function showProfileError(msg, type = 'error') {
  const el = document.getElementById('profile-error');
  el.textContent = msg; el.style.display = 'block';
  const s = {
    error:   { bg:'rgba(226,75,74,0.12)',  border:'var(--danger)',  color:'var(--danger)'  },
    success: { bg:'rgba(34,201,122,0.12)', border:'var(--success)', color:'var(--success)' },
  }[type] || {};
  el.style.background = s.bg; el.style.borderColor = s.border; el.style.color = s.color;
}

// --------------------------------------------------
//  Upload de foto de perfil (Supabase Storage)
// --------------------------------------------------
async function handleAvatarUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const statusEl = document.getElementById('avatar-upload-status');
  statusEl.style.display = 'block';

  // Validação de tipo
  if (!file.type.startsWith('image/')) {
    statusEl.textContent = 'Selecione apenas arquivos de imagem.';
    statusEl.style.color = 'var(--danger)';
    return;
  }

  // Validação de tamanho — máximo 2MB
  if (file.size > AVATAR_MAX_BYTES) {
    const sizeMb = (file.size / (1024*1024)).toFixed(1);
    statusEl.textContent = `Imagem muito grande (${sizeMb}MB). Máximo permitido: 2MB.`;
    statusEl.style.color = 'var(--danger)';
    event.target.value = '';
    return;
  }

  statusEl.textContent = 'Enviando...';
  statusEl.style.color = 'var(--text2)';

  try {
    const ext      = file.name.split('.').pop().toLowerCase();
    const filePath = `${currentUser.id}/avatar.${ext}`;

    // Upload para o bucket "avatars" (upsert substitui foto anterior)
    const { error: uploadError } = await sb.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true, cacheControl: '3600' });

    if (uploadError) throw uploadError;

    // Gera URL pública com cache-busting
    const { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
    const avatarUrl = urlData.publicUrl + '?t=' + Date.now();

    // Salva a URL no metadata do usuário
    const { error: updateError } = await sb.auth.updateUser({
      data: { avatar_url: avatarUrl }
    });
    if (updateError) throw updateError;

    // Atualiza currentUser local e UI
    currentUser.user_metadata = { ...currentUser.user_metadata, avatar_url: avatarUrl };
    const name = currentUser.user_metadata.full_name || currentUser.user_metadata.name || currentUser.email.split('@')[0];
    applyAvatar(document.getElementById('profile-avatar'), name, avatarUrl);
    applyAvatar(document.getElementById('user-avatar'), name, avatarUrl);

    statusEl.textContent = '✓ Foto atualizada!';
    statusEl.style.color = 'var(--success)';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
  } catch (e) {
    console.error('Erro ao enviar avatar:', e);
    statusEl.textContent = 'Erro ao enviar imagem. Tente novamente.';
    statusEl.style.color = 'var(--danger)';
  } finally {
    event.target.value = '';
  }
}

// --------------------------------------------------
//  Atualizar nome
// --------------------------------------------------
async function saveProfileName() {
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) return showProfileError('Digite um nome.');

  const btn = document.getElementById('save-name-btn');
  btn.disabled = true;

  const { error } = await sb.auth.updateUser({ data: { full_name: name } });

  btn.disabled = false;

  if (error) return showProfileError('Erro ao salvar nome: ' + error.message);

  // Atualiza UI imediatamente
  currentUser.user_metadata = { ...currentUser.user_metadata, full_name: name };
  const provider = currentUser.app_metadata?.provider || '';
  const badge = provider === 'google'
    ? '<span style="font-size:10px;background:#4285F420;color:#4285F4;padding:2px 7px;border-radius:20px;margin-left:6px">Google</span>'
    : '';
  document.getElementById('user-name').innerHTML = name + badge;
  applyAvatar(document.getElementById('profile-avatar'), name, currentUser.user_metadata.avatar_url);
  applyAvatar(document.getElementById('user-avatar'), name, currentUser.user_metadata.avatar_url);

  showProfileError('Nome atualizado com sucesso!', 'success');
  setTimeout(() => { document.getElementById('profile-error').style.display = 'none'; }, 2000);
}

// --------------------------------------------------
//  Atualizar senha (usuário logado)
// --------------------------------------------------
async function saveProfilePassword() {
  const pass  = document.getElementById('profile-new-password').value;
  const pass2 = document.getElementById('profile-new-password2').value;

  if (!pass)           return showProfileError('Digite a nova senha.');
  if (pass.length < 6) return showProfileError('A senha deve ter pelo menos 6 caracteres.');
  if (pass !== pass2)  return showProfileError('As senhas não coincidem.');

  const btn = document.getElementById('save-password-btn');
  btn.disabled = true;

  const { error } = await sb.auth.updateUser({ password: pass });

  btn.disabled = false;

  if (error) return showProfileError('Erro ao atualizar senha: ' + error.message);

  document.getElementById('profile-new-password').value  = '';
  document.getElementById('profile-new-password2').value = '';
  showProfileError('Senha atualizada com sucesso!', 'success');
}










