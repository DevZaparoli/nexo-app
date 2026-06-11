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
  document.getElementById('tab-login').style.display   = tab === 'login'    ? 'block' : 'none';
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
  if (error) return showAuthError(translateError(error.message));
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

  if (error) return showAuthError(translateError(error.message));
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
  if (!email) return showAuthError('Digite seu e-mail para recuperar a senha.');
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '?reset=true'
  });
  if (error) return showAuthError(translateError(error.message));
  showAuthError('Link de recuperação enviado para ' + email, 'success');
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

  // Preenche dados do usuário na sidebar
  const meta    = currentUser.user_metadata || {};
  const name    = meta.full_name || meta.name || currentUser.email.split('@')[0];
  const email   = currentUser.email;
  const initials = name.slice(0, 2).toUpperCase();

  document.getElementById('user-avatar').textContent    = initials;
  document.getElementById('user-name').textContent      = name;
  document.getElementById('user-email').textContent     = email;
  document.getElementById('profile-avatar').textContent = initials;
  document.getElementById('profile-name').textContent   = name;
  document.getElementById('profile-email').textContent  = email;

  // Carrega lembretes do banco
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
  el.style.background = type === 'success' ? 'rgba(34,201,122,0.12)' : 'rgba(226,75,74,0.12)';
  el.style.borderColor = type === 'success' ? 'var(--success)' : 'var(--danger)';
  el.style.color       = type === 'success' ? 'var(--success)' : 'var(--danger)';
}
function hideAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

function translateError(msg) {
  const map = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'Confirme seu e-mail antes de entrar.',
    'User already registered': 'Este e-mail já está cadastrado.',
    'Password should be at least 6 characters': 'A senha deve ter ao menos 6 caracteres.',
  };
  return map[msg] || msg;
}

// --------------------------------------------------
//  Modal de perfil
// --------------------------------------------------
function openProfileModal()  { document.getElementById('profile-modal').classList.add('show'); }
function closeProfileModal() { document.getElementById('profile-modal').classList.remove('show'); }
