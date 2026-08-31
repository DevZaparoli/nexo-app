import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const config = await readFile(new URL('../public/js/config.js', import.meta.url), 'utf8');
const authSource = await readFile(new URL('../public/js/auth.js', import.meta.url), 'utf8');

assert(!authSource.includes('onAuthStateChange(async'), 'OAuth callback must not await Supabase calls directly');
assert.match(authSource, /onAuthStateChange\([\s\S]*?setTimeout\(async/, 'Auth state work must be deferred');

function readConfigConstant(name) {
  const match = config.match(new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`));
  assert(match, `${name} was not found in public/js/config.js`);
  return match[1];
}

const storageValues = new Map();
const storage = {
  getItem: key => storageValues.get(key) ?? null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: key => storageValues.delete(key),
};

const client = createClient(
  readConfigConstant('SUPABASE_URL'),
  readConfigConstant('SUPABASE_ANON_KEY'),
  {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      persistSession: true,
      storage,
    },
  },
);

const callback = 'nexo://auth/callback';
const { data, error } = await client.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: callback,
    skipBrowserRedirect: true,
    queryParams: { prompt: 'select_account' },
  },
});

assert.ifError(error);
assert(data?.url, 'Supabase did not return an OAuth URL');

const authorizeUrl = new URL(data.url);
assert.equal(authorizeUrl.protocol, 'https:');
assert.equal(authorizeUrl.hostname, 'cetsgcfqwvrcqplzopxg.supabase.co');
assert.equal(authorizeUrl.pathname, '/auth/v1/authorize');
assert.equal(authorizeUrl.searchParams.get('provider'), 'google');
assert.equal(authorizeUrl.searchParams.get('redirect_to'), callback);
assert.equal(authorizeUrl.searchParams.get('prompt'), 'select_account');
assert(authorizeUrl.searchParams.get('code_challenge'), 'PKCE code challenge is missing');
assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 's256');

console.log('Google OAuth desktop URL and PKCE callback are valid.');
