# RemindMe 🔔

Site de lembretes com notificações push, dark mode, login com e-mail/Google e sincronização em nuvem via Supabase.

---

## Stack
- **Frontend**: HTML + CSS + JavaScript puro (sem framework)
- **Backend / Banco**: Supabase (Auth + PostgreSQL + RLS)
- **Notificações**: Web Notifications API + sons via Web Audio API
- **Hospedagem sugerida**: Vercel, Netlify ou GitHub Pages

---

## Configuração passo a passo

### 1. Criar projeto no Supabase

1. Acesse [https://app.supabase.com](https://app.supabase.com) e crie uma conta gratuita
2. Clique em **New project**
3. Escolha um nome (ex: `remindme`) e uma senha forte para o banco
4. Aguarde o projeto ser criado (~1 min)

---

### 2. Criar a tabela no banco

1. No painel do Supabase, vá em **SQL Editor → New query**
2. Cole todo o conteúdo do arquivo `schema.sql`
3. Clique em **Run** (▶)
4. Confirme que a tabela `reminders` foi criada em **Table Editor**

---

### 3. Ativar autenticação

#### E-mail e senha
1. Vá em **Authentication → Providers → Email**
2. Certifique-se de que está **habilitado**
3. Opcional: desative "Confirm email" para testes rápidos

#### Google OAuth
1. Vá em **Authentication → Providers → Google**
2. Clique em **Enable**
3. Crie credenciais OAuth no [Google Cloud Console](https://console.cloud.google.com):
   - Novo projeto → APIs & Services → Credentials → Create OAuth Client ID
   - Tipo: **Web application**
   - Authorized redirect URIs: `https://SEU_PROJETO.supabase.co/auth/v1/callback`
4. Cole **Client ID** e **Client Secret** no Supabase

---

### 4. Configurar as credenciais no projeto

1. No Supabase, vá em **Settings → API**
2. Copie:
   - **Project URL** (ex: `https://abcdefgh.supabase.co`)
   - **anon public key** (começa com `eyJ...`)
3. Abra o arquivo `public/js/config.js` e substitua:

```js
const SUPABASE_URL      = 'https://SEU_PROJETO.supabase.co'; // ← cole aqui
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY_AQUI';              // ← cole aqui
```

---

### 5. Rodar localmente

Você precisa de um servidor HTTP simples (não abra o `index.html` direto como arquivo — o Supabase bloqueia origens `file://`).

**Opção A — VS Code + Live Server**
- Instale a extensão **Live Server**
- Clique com o botão direito em `index.html` → **Open with Live Server**

**Opção B — Python**
```bash
cd remindme
python3 -m http.server 3000
# Acesse: http://localhost:3000
```

**Opção C — Node.js**
```bash
npx serve remindme
```

---

### 6. Publicar online (Vercel)

```bash
npm i -g vercel
cd remindme
vercel
```

Ou arraste a pasta para [vercel.com/new](https://vercel.com/new).

Após publicar, adicione a URL do deploy em:
- Supabase → **Authentication → URL Configuration → Site URL**
- Google Cloud → **Authorized redirect URIs** (se usar Google OAuth)

---

## Estrutura do projeto

```
remindme/
├── index.html              # Página principal (auth + app)
├── schema.sql              # SQL para criar a tabela no Supabase
├── manifest.json           # PWA (instalar no celular)
└── public/
    ├── css/
    │   └── style.css       # Estilos dark mode
    ├── js/
    │   ├── config.js       # ← Suas credenciais Supabase
    │   ├── auth.js         # Login, registro, Google OAuth, logout
    │   └── app.js          # CRUD de lembretes + notificações
    └── icons/
        ├── icon-192.png    # Ícone PWA (adicione manualmente)
        └── icon-512.png    # Ícone PWA (adicione manualmente)
```

---

## Funcionalidades

| Feature | Status |
|---|---|
| Login com e-mail e senha | ✅ |
| Login com Google | ✅ |
| Recuperação de senha por e-mail | ✅ |
| Criar / editar / excluir lembretes | ✅ |
| Notificações push no navegador | ✅ |
| Sons de notificação (Web Audio API) | ✅ |
| Repetição diária / semanal / mensal | ✅ |
| Categorias com cores | ✅ |
| Prioridades (normal / alta / urgente) | ✅ |
| Filtros e busca em tempo real | ✅ |
| Dashboard de métricas | ✅ |
| Dados isolados por usuário (RLS) | ✅ |
| Dark mode nativo | ✅ |
| Responsivo (mobile) | ✅ |
| PWA (instalável no celular) | ✅ |

---

## Segurança

- **Row Level Security** ativada: cada usuário só acessa seus próprios dados, mesmo que tente manipular requisições
- A `anon key` é pública por design — a segurança real vem das políticas RLS no banco
- Nunca exponha a `service_role key` no frontend

---

## Dúvidas comuns

**"Invalid API key"** → Verifique se colou a URL e a anon key corretamente em `config.js`

**"Redirect URI mismatch"** → Certifique-se de que a URL do Supabase está nas URIs autorizadas do Google Cloud

**Notificações não aparecem** → Clique em "Ativar agora" no banner roxo dentro do app e permita no navegador
