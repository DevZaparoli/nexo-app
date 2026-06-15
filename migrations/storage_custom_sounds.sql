-- =====================================================
--  STORAGE: bucket "custom-sounds" para sons personalizados
--  Execute no SQL Editor do Supabase
-- =====================================================

-- 1. Cria o bucket público "custom-sounds" (até 5MB por arquivo)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'custom-sounds',
  'custom-sounds',
  true,
  5242880, -- 5MB em bytes
  ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/webm','audio/m4a','audio/x-m4a','audio/aac']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['audio/mpeg','audio/mp3','audio/wav','audio/ogg','audio/webm','audio/m4a','audio/x-m4a','audio/aac'];

-- 2. Policy: qualquer pessoa pode VISUALIZAR/OUVIR sons (bucket público)
CREATE POLICY "custom_sounds_public_select"
ON storage.objects FOR SELECT
USING (bucket_id = 'custom-sounds');

-- 3. Policy: usuário só pode ENVIAR para sua própria pasta (uid/...)
CREATE POLICY "custom_sounds_user_insert"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'custom-sounds'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. Policy: usuário pode deletar seus próprios sons
CREATE POLICY "custom_sounds_user_delete"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'custom-sounds'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
