// =====================================================
//  AUTH — Login, Registro, Google OAuth, Logout
// =====================================================

let currentUser = null;

// Verifica sessão ao carregar
sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    await showApp();

    // Detecta primeiro login com Google → abre painel de senha
    if (event === 'SIGNED_IN') {
      const provider  = currentUser.app_metadata?.provider || '';
      const createdAt = new Date(currentUser.created_at).getTime();
      const now       = Date.now();
      const isNew     = (now - createdAt) < 30000; // criado há menos de 30s
      const hasPassword = currentUser.identities?.some(i => i.provider === 'email');

      if (provider === 'google' && isNew && !hasPassword) {
        openCompleteProfileModal();
      }
    }
  } else {
    currentUser = null;
    showAuth();
  }
});

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
    if (error.message === 'Invalid login credentials') {
      return showAuthError(
        'E-mail ou senha incorretos. Se você entrou com Google antes, use o botão "Continuar com Google".',
        'warning'
      );
    }
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
  if (password.length < 6) return showAuthError('A senha precisa ter pelo menos 6 caracteres.');

  const { error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } }
  });

  if (error) {
    if (error.message === 'User already registered') {
      return showAuthError(
        'Este e-mail já está cadastrado. Tente entrar com sua senha ou use "Continuar com Google".',
        'warning'
      );
    }
    return showAuthError(translateError(error.message));
  }

  showAuthError('Verifique seu e-mail para confirmar o cadastro!', 'success');
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
  if (!email) return showAuthError('Digite seu e-mail no campo acima.');

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=true'
  });

  if (error) {
    if (error.message?.toLowerCase().includes('not found') ||
        error.message?.toLowerCase().includes('user not found')) {
      return showAuthError(
        'Este e-mail está vinculado ao Google. Use o botão "Continuar com Google" para entrar.',
        'warning'
      );
    }
    return showAuthError(translateError(error.message));
  }

  showAuthError('Link enviado para ' + email + '. Verifique sua caixa de entrada.', 'success');
}

// --------------------------------------------------
//  Logout
// --------------------------------------------------
async function logout() {
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
  const initials = name.slice(0, 2).toUpperCase();
  const provider = currentUser.app_metadata?.provider || '';
  const badge    = provider === 'google'
    ? '<span style="font-size:10px;background:#4285F420;color:#4285F4;padding:2px 7px;border-radius:20px;margin-left:6px">Google</span>'
    : '';

  document.getElementById('user-avatar').textContent    = initials;
  document.getElementById('user-name').innerHTML        = name + badge;
  document.getElementById('user-email').textContent     = email;
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').innerHTML     = name + badge;
  document.getElementById('profile-email').textContent  = email;

  await loadReminders();
  checkPermBanner();
}

// --------------------------------------------------
//  PAINEL "Completar perfil" — Google first login
// --------------------------------------------------
function openCompleteProfileModal() {
  const meta     = currentUser.user_metadata || {};
  const name     = meta.full_name || meta.name || currentUser.email.split('@')[0];
  const email    = currentUser.email;
  const initials = name.slice(0, 2).toUpperCase();

  document.getElementById('complete-avatar').textContent = initials;
  document.getElementById('complete-name').textContent   = name;
  document.getElementById('complete-email').textContent  = email;
  document.getElementById('complete-password').value     = '';
  document.getElementById('complete-password2').value    = '';
  document.getElementById('complete-profile-error').style.display = 'none';
  document.getElementById('complete-profile-modal').classList.add('show');
}

function closeCompleteProfileModal() {
  document.getElementById('complete-profile-modal').classList.remove('show');
}

function skipCompleteProfile() {
  closeCompleteProfileModal();
  showToast('Tudo certo!', 'Você pode adicionar uma senha depois nas configurações.');
}

async function saveCompleteProfile() {
  const pass  = document.getElementById('complete-password').value;
  const pass2 = document.getElementById('complete-password2').value;
  const errEl = document.getElementById('complete-profile-error');

  errEl.style.display = 'none';

  if (!pass) return showCompleteError('Digite uma senha.');
  if (pass.length < 6) return showCompleteError('A senha deve ter pelo menos 6 caracteres.');
  if (pass !== pass2)  return showCompleteError('As senhas não coincidem.');

  const btn = document.getElementById('complete-save-btn');
  btn.disabled = true;

  const { error } = await sb.auth.updateUser({ password: pass });

  btn.disabled = false;

  if (error) return showCompleteError('Erro ao salvar senha: ' + error.message);

  closeCompleteProfileModal();
  showToast('Senha criada com sucesso!', 'Agora você pode entrar com e-mail e senha também.');
}

function showCompleteError(msg) {
  const el = document.getElementById('complete-profile-error');
  el.textContent   = msg;
  el.style.display = 'block';
  el.style.background  = 'rgba(226,75,74,0.12)';
  el.style.borderColor = 'var(--danger)';
  el.style.color       = 'var(--danger)';
}

function togglePassVis(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  if (input.type === 'password') {
    input.type = 'text';
    icon.innerHTML = '<i class="ti ti-eye-off"></i>';
  } else {
    input.type = 'password';
    icon.innerHTML = '<i class="ti ti-eye"></i>';
  }
}

// --------------------------------------------------
//  Helpers de mensagem
// --------------------------------------------------
function showAuthError(msg, type = 'error') {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
  const styles = {
    error:   { bg:'rgba(226,75,74,0.12)',  border:'var(--danger)',  color:'var(--danger)'  },
    warning: { bg:'rgba(245,166,35,0.12)', border:'var(--warning)', color:'var(--warning)' },
    success: { bg:'rgba(34,201,122,0.12)', border:'var(--success)', color:'var(--success)' },
  };
  const s = styles[type] || styles.error;
  el.style.background  = s.bg;
  el.style.borderColor = s.border;
  el.style.color       = s.color;
}

function hideAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

function translateError(msg) {
  const map = {
    'Invalid login credentials':               'E-mail ou senha incorretos.',
    'Email not confirmed':                     'Confirme seu e-mail antes de entrar.',
    'User already registered':                 'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters':'A senha deve ter ao menos 6 caracteres.',
    'Email rate limit exceeded':               'Muitas tentativas. Aguarde alguns minutos.',
  };
  return map[msg] || msg;
}

// --------------------------------------------------
//  Modal de perfil
// --------------------------------------------------
function openProfileModal()  { document.getElementById('profile-modal').classList.add('show'); }
function closeProfileModal() { document.getElementById('profile-modal').classList.remove('show'); }
