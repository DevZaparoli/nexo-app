-- =====================================================
--  MIGRATION: tabela reminder_logs
--  Registra cada disparo de lembrete repetitivo
--  Execute no SQL Editor do Supabase
-- =====================================================

CREATE TABLE IF NOT EXISTS reminder_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id  UUID NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       TEXT NOT NULL DEFAULT 'fired'
               CHECK (status IN ('fired','completed','snoozed','ignored')),
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_reminder_id ON reminder_logs(reminder_id);
CREATE INDEX IF NOT EXISTS idx_logs_user_id     ON reminder_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_logs_fired_at    ON reminder_logs(fired_at DESC);

ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logs_select_own" ON reminder_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "logs_insert_own" ON reminder_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "logs_update_own" ON reminder_logs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "logs_delete_own" ON reminder_logs
  FOR DELETE USING (auth.uid() = user_id);
