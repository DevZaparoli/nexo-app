// =====================================================
//  AUTH — Login, Registro, Google OAuth, Logout
// =====================================================

let currentUser = null;

// Verifica sessão ao carregar
sb.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user;
    await showApp();
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
    // Se credenciais inválidas, verifica se o e-mail existe via Google
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
//  Se o usuário só tem conta Google, avisa que não há senha
// --------------------------------------------------
async function forgotPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) return showAuthError('Digite seu e-mail no campo acima para recuperar a senha.');

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=true'
  });

  if (error) {
    // Supabase retorna este erro quando o e-mail não tem senha (só OAuth)
    if (error.message?.toLowerCase().includes('not found') ||
        error.message?.toLowerCase().includes('user not found')) {
      return showAuthError(
        'Este e-mail está vinculado ao Google. Use o botão "Continuar com Google" para entrar.',
        'warning'
      );
    }
    return showAuthError(translateError(error.message));
  }

  showAuthError('Link de recuperação enviado para ' + email + '. Verifique sua caixa de entrada.', 'success');
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

  // Indica se entrou via Google
  const provider = currentUser.app_metadata?.provider || '';
  const providerBadge = provider === 'google'
    ? '<span style="font-size:10px;background:#4285F420;color:#4285F4;padding:2px 7px;border-radius:20px;margin-left:6px">Google</span>'
    : '';

  document.getElementById('user-avatar').textContent    = initials;
  document.getElementById('user-name').innerHTML        = name + providerBadge;
  document.getElementById('user-email').textContent     = email;
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').innerHTML     = name + providerBadge;
  document.getElementById('profile-email').textContent  = email;

  await loadReminders();
  checkPermBanner();
}

// --------------------------------------------------
//  Helpers de mensagem
// --------------------------------------------------
function showAuthError(msg, type = 'error') {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';

  const styles = {
    error:   { bg: 'rgba(226,75,74,0.12)',  border: 'var(--danger)',  color: 'var(--danger)'  },
    warning: { bg: 'rgba(245,166,35,0.12)', border: 'var(--warning)', color: 'var(--warning)' },
    success: { bg: 'rgba(34,201,122,0.12)', border: 'var(--success)', color: 'var(--success)' },
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
    'Invalid login credentials':              'E-mail ou senha incorretos.',
    'Email not confirmed':                    'Confirme seu e-mail antes de entrar.',
    'User already registered':                'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters': 'A senha deve ter ao menos 6 caracteres.',
    'Email rate limit exceeded':              'Muitas tentativas. Aguarde alguns minutos.',
  };
  return map[msg] || msg;
}

// --------------------------------------------------
//  Modal de perfil
// --------------------------------------------------
function openProfileModal()  { document.getElementById('profile-modal').classList.add('show'); }
function closeProfileModal() { document.getElementById('profile-modal').classList.remove('show'); }
