-- =====================================================
--  SCHEMA REMINDME — Execute no SQL Editor do Supabase
--  Acesse: https://app.supabase.com → SQL Editor → New query
-- =====================================================

-- Tabela principal de lembretes
CREATE TABLE IF NOT EXISTS reminders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  reminder_at  TIMESTAMPTZ,
  category     TEXT DEFAULT 'Pessoal',
  priority     TEXT DEFAULT 'normal' CHECK (priority IN ('normal','alta','urgente')),
  repeat_type  TEXT DEFAULT 'none'   CHECK (repeat_type IN ('none','daily','weekly','monthly')),
  repeat_end   DATE,
  sound        TEXT DEFAULT 'padrão',
  advance_min  INTEGER DEFAULT 0,
  done         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_reminders_user_id    ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_reminder_at ON reminders(reminder_at);
CREATE INDEX IF NOT EXISTS idx_reminders_done        ON reminders(done);

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =====================================================
--  ROW LEVEL SECURITY (RLS)
--  Garante que cada usuário veja apenas seus próprios dados
-- =====================================================

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Usuário só lê os próprios lembretes
CREATE POLICY "select_own" ON reminders
  FOR SELECT USING (auth.uid() = user_id);

-- Usuário só cria lembretes para si mesmo
CREATE POLICY "insert_own" ON reminders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Usuário só edita os próprios lembretes
CREATE POLICY "update_own" ON reminders
  FOR UPDATE USING (auth.uid() = user_id);

-- Usuário só exclui os próprios lembretes
CREATE POLICY "delete_own" ON reminders
  FOR DELETE USING (auth.uid() = user_id);
