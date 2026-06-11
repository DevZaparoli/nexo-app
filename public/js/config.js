// =====================================================
//  CONFIGURAÇÃO DO SUPABASE
//  Substitua os valores abaixo com os dados do seu projeto
//  Acesse: https://app.supabase.com → Settings → API
// =====================================================

const SUPABASE_URL = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY_AQUI';

// Inicializa o cliente Supabase
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
