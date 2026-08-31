import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const desktopSource = await readFile(new URL('../public/js/desktop.js', import.meta.url), 'utf8');
const rustSource = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const browserArgs = config.app.windows[0].additionalBrowserArgs || '';

assert.match(browserArgs, /--autoplay-policy=no-user-gesture-required/);
assert.match(appSource, /warmCustomSoundsForReminders\(\)/);
assert.match(appSource, /fetch\(source\.url,/);
assert.match(appSource, /cache: 'force-cache'/);
assert.match(appSource, /function getCustomSoundSources/);
assert.match(appSource, /addUrl\(parsed\.storedUrl\)/);
assert.match(appSource, /const customSoundLoads = new Map\(\)/);
assert.match(appSource, /new AbortController\(\)/);
assert.match(appSource, /URL\.createObjectURL\(blob\)/);
assert.match(appSource, /async function playCustomSound/);
assert.match(appSource, /audio\.play\(\)/);
assert.match(appSource, /playSound\('padrão', 1\)/);
assert.match(appSource, /payload\.sound \|\| r\.sound/);
assert.match(desktopSource, /sound: String\(reminder\.sound \|\| 'padrão'\)/);
assert.match(rustSource, /sound TEXT NOT NULL DEFAULT 'padrão'/);
assert.match(rustSource, /notification\.sound_name\("Default"\)/);
assert.match(rustSource, /native_sound: bool/);

// Exercita a migração aplicada em instalações que ainda possuem o banco 0.2.6.
const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE notification_jobs (
    job_id TEXT PRIMARY KEY,
    reminder_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    fire_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    fired_at INTEGER
  );
  INSERT INTO notification_jobs
    (job_id, reminder_id, user_id, kind, title, body, fire_at)
  VALUES ('old-job', 'reminder-1', 'user-1', 'on_time', 'Teste', 'Corpo', 1);
  ALTER TABLE notification_jobs
    ADD COLUMN sound TEXT NOT NULL DEFAULT 'padrão';
`);
const migratedJob = database.prepare(
  'SELECT sound FROM notification_jobs WHERE job_id = ?'
).get('old-job');
assert.equal(migratedJob.sound, 'padrão');
database.close();

console.log('Fluxo persistente de áudio do desktop validado.');
