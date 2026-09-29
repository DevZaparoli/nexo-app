import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const desktopSource = await readFile(new URL('../public/js/desktop.js', import.meta.url), 'utf8');
const rustSource = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

assert.match(html, /id="desktop-enabled-toggle"/);
assert.match(html, /lembretes repetitivos sem término reiniciam a contagem/);
assert.match(desktopSource, /invoke\('set_scheduler_enabled'/);
assert.match(desktopSource, /window\.resumeNexoFromToday\(\)/);
assert.match(appSource, /\.filter\(r => r\.repeat !== 'none' && !r\.repeatEnd\)/);
assert.match(appSource, /done: false/);
assert.match(rustSource, /CREATE TABLE IF NOT EXISTS app_settings/);
assert.match(rustSource, /if !scheduler_is_enabled\(&connection\)\? \{/);
assert.match(rustSource, /DELETE FROM notification_jobs WHERE state = 'pending'/);

const functionStart = appSource.indexOf('function getReactivatedOccurrenceDate');
const functionEnd = appSource.indexOf('\nasync function resumeNexoFromToday', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart);
const getReactivatedOccurrenceDate = new Function(
  `${appSource.slice(functionStart, functionEnd)}; return getReactivatedOccurrenceDate;`,
)();

const at = (value) => new Date(value);
assert.equal(
  getReactivatedOccurrenceDate({ repeat: 'daily', repeatEnd: '', time: '09:00' }, at('2026-09-29T08:00:00')).getDate(),
  29,
);
assert.equal(
  getReactivatedOccurrenceDate({ repeat: 'daily', repeatEnd: '', time: '09:00' }, at('2026-09-29T10:00:00')).getDate(),
  30,
);

const weeklyActivation = at('2026-09-29T10:00:00');
const tomorrowWeekday = (weeklyActivation.getDay() + 1) % 7;
const selectedWeekday = getReactivatedOccurrenceDate(
  { repeat: 'weekly', repeatEnd: '', time: '09:00', weekdays: [tomorrowWeekday] },
  weeklyActivation,
);
assert.equal(selectedWeekday.getDate(), 30);

const weeklyFromActivation = getReactivatedOccurrenceDate(
  { repeat: 'weekly', repeatEnd: '', time: '09:00', weekdays: [] },
  weeklyActivation,
);
assert.equal(weeklyFromActivation.getDate(), 6);
assert.equal(weeklyFromActivation.getMonth(), 9);

const monthly = getReactivatedOccurrenceDate(
  { repeat: 'monthly', repeatEnd: '', time: '09:00' },
  at('2026-01-31T10:00:00'),
);
assert.equal(monthly.getMonth(), 1);
assert.equal(monthly.getDate(), 28);
assert.equal(
  getReactivatedOccurrenceDate({ repeat: 'daily', repeatEnd: '2026-12-31', time: '09:00' }, weeklyActivation),
  null,
);

const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE notification_jobs (
    job_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT INTO app_settings (key, value) VALUES ('scheduler_enabled', '1');
  INSERT INTO notification_jobs (job_id) VALUES ('pending-job');
  UPDATE app_settings SET value = '0' WHERE key = 'scheduler_enabled';
  DELETE FROM notification_jobs WHERE state = 'pending';
`);
assert.equal(
  database.prepare("SELECT value FROM app_settings WHERE key = 'scheduler_enabled'").get().value,
  '0',
);
assert.equal(database.prepare('SELECT COUNT(*) AS count FROM notification_jobs').get().count, 0);
database.close();

console.log('Fluxo de pausa e reativação do Nexo validado.');
