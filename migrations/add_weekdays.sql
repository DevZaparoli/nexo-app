-- =====================================================
--  MIGRATION: adiciona coluna weekdays para repetição semanal
--  Execute no SQL Editor do Supabase
-- =====================================================

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS weekdays INTEGER[] DEFAULT NULL;

COMMENT ON COLUMN reminders.weekdays IS 'Dias da semana para repetição semanal (0=domingo .. 6=sábado)';
