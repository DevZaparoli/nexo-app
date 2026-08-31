# Nexo

Aplicativo de lembretes com sincronização pelo Supabase, modo escuro e login.

## Aplicativo desktop (Windows)

A versão desktop usa Tauri 2. Ela mantém o visual web existente, adicionando:

- instalador nativo para Windows;
- ícone na bandeja e execução em segundo plano;
- opção de iniciar junto com o Windows;
- notificações nativas;
- login Google pelo navegador com retorno seguro ao aplicativo via PKCE;
- agendador persistente em SQLite, que recupera lembretes após suspensão ou reinício.

### Desenvolvimento

Pré-requisitos: Node.js 20+, pnpm, Rust e Microsoft C++ Build Tools.

```powershell
pnpm install
pnpm desktop:dev
```

### Gerar instaladores

```powershell
pnpm desktop:build
```

Os artefatos são gravados em `src-tauri/target/release/bundle/`.

## Versão web

```powershell
pnpm build:web
```

O conteúdo publicado é gerado em `dist/`. A biblioteca do Supabase é copiada
localmente durante o build, evitando depender de um CDN para abrir o aplicativo.

## Autenticação no desktop

O login por e-mail e senha funciona nos dois ambientes. No desktop, “Continuar
com Google” abre o navegador padrão e retorna ao aplicativo pelo protocolo
`nexo://auth/callback`. Esse protocolo é registrado pelo instalador; por isso o
fluxo Google deve ser testado com a versão instalada, e não somente com o binário
executado diretamente da pasta `target`.
