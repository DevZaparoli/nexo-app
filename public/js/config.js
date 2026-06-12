// =====================================================
//  CONFIGURAÇÃO DO SUPABASE
// =====================================================

const SUPABASE_URL = 'https://cetsgcfqwvrcqplzopxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNldHNnY2Zxd3ZyY3FwbHpvcHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDAyOTcsImV4cCI6MjA5Njc3NjI5N30.8Am8bba6apa4cudeV8qf8rNyw43Ira99mCuBqE5VjxQ';

// Inicializa o cliente Supabase
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
