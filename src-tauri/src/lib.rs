use chrono::Utc;
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, Url, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

const LATE_NOTIFICATION_GRACE_MS: i64 = 24 * 60 * 60 * 1_000;
const FIRED_JOB_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;
const OAUTH_CALLBACK_URL: &str = "nexo://auth/callback";
const SUPABASE_AUTH_HOST: &str = "cetsgcfqwvrcqplzopxg.supabase.co";
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

fn default_reminder_sound() -> String {
    "padrão".to_string()
}

#[derive(Clone)]
struct SchedulerState {
    database_path: PathBuf,
}

#[derive(Default)]
struct OAuthCallbackState {
    pending: Mutex<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderInput {
    id: String,
    user_id: String,
    title: String,
    body: String,
    #[serde(default = "default_reminder_sound")]
    sound: String,
    fire_at: i64,
    advance_minutes: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncRequest {
    user_id: String,
    reminders: Vec<ReminderInput>,
}

#[derive(Debug)]
struct NotificationJob {
    job_id: String,
    reminder_id: String,
    kind: String,
    title: String,
    body: String,
    sound: String,
    fire_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderFiredPayload {
    reminder_id: String,
    kind: String,
    sound: String,
    native_sound: bool,
    fire_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SchedulerStatus {
    pending_jobs: i64,
    database_path: String,
}

fn open_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn initialize_database(path: &Path) -> Result<(), String> {
    let connection = open_database(path)?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS notification_jobs (
                job_id TEXT PRIMARY KEY,
                reminder_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL CHECK (kind IN ('advance', 'on_time')),
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                sound TEXT NOT NULL DEFAULT 'padrão',
                fire_at INTEGER NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'fired')),
                fired_at INTEGER
            );
             CREATE INDEX IF NOT EXISTS idx_notification_jobs_due
               ON notification_jobs(state, fire_at);
             CREATE INDEX IF NOT EXISTS idx_notification_jobs_user
               ON notification_jobs(user_id, reminder_id);",
        )
        .map_err(|error| error.to_string())?;

    let has_sound_column: i64 = connection
        .query_row(
            "SELECT COUNT(*)
             FROM pragma_table_info('notification_jobs')
             WHERE name = 'sound'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    if has_sound_column == 0 {
        connection
            .execute(
                "ALTER TABLE notification_jobs
                 ADD COLUMN sound TEXT NOT NULL DEFAULT 'padrão'",
                [],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn insert_job(
    transaction: &Transaction<'_>,
    reminder: &ReminderInput,
    kind: &str,
    fire_at: i64,
    body: &str,
) -> Result<(), String> {
    let job_id = format!("{}:{kind}:{fire_at}", reminder.id);
    transaction
        .execute(
            "INSERT OR IGNORE INTO notification_jobs
             (job_id, reminder_id, user_id, kind, title, body, sound, fire_at, state)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')",
            params![
                job_id,
                reminder.id,
                reminder.user_id,
                kind,
                reminder.title,
                body,
                reminder.sound,
                fire_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_reminder_jobs(
    transaction: &Transaction<'_>,
    reminder: &ReminderInput,
) -> Result<(), String> {
    if reminder.fire_at <= 0 {
        return Ok(());
    }

    let on_time_body = if reminder.body.trim().is_empty() {
        "Hora do seu lembrete!"
    } else {
        reminder.body.as_str()
    };
    insert_job(
        transaction,
        reminder,
        "on_time",
        reminder.fire_at,
        on_time_body,
    )?;

    if reminder.advance_minutes > 0 {
        let advance_at = reminder.fire_at - reminder.advance_minutes * 60_000;
        let advance_body = format!(
            "Em {} minuto(s): {}",
            reminder.advance_minutes, on_time_body
        );
        insert_job(transaction, reminder, "advance", advance_at, &advance_body)?;
    }

    Ok(())
}

#[tauri::command]
fn sync_reminders(request: SyncRequest, state: State<'_, SchedulerState>) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    let mut connection = open_database(&state.database_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "DELETE FROM notification_jobs WHERE user_id = ?1 AND state = 'pending'",
            params![request.user_id],
        )
        .map_err(|error| error.to_string())?;

    for reminder in request
        .reminders
        .iter()
        .filter(|reminder| reminder.user_id == request.user_id)
    {
        insert_reminder_jobs(&transaction, reminder)?;
    }

    transaction
        .execute(
            "DELETE FROM notification_jobs
             WHERE state = 'fired' AND fired_at IS NOT NULL AND fired_at < ?1",
            params![now - FIRED_JOB_RETENTION_MS],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
fn upsert_reminder(
    reminder: ReminderInput,
    state: State<'_, SchedulerState>,
) -> Result<(), String> {
    let mut connection = open_database(&state.database_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM notification_jobs
             WHERE reminder_id = ?1 AND user_id = ?2 AND state = 'pending'",
            params![reminder.id, reminder.user_id],
        )
        .map_err(|error| error.to_string())?;
    insert_reminder_jobs(&transaction, &reminder)?;
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_reminder(
    reminder_id: String,
    user_id: String,
    state: State<'_, SchedulerState>,
) -> Result<(), String> {
    let connection = open_database(&state.database_path)?;
    connection
        .execute(
            "DELETE FROM notification_jobs WHERE reminder_id = ?1 AND user_id = ?2",
            params![reminder_id, user_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn clear_reminders(user_id: String, state: State<'_, SchedulerState>) -> Result<(), String> {
    let connection = open_database(&state.database_path)?;
    connection
        .execute(
            "DELETE FROM notification_jobs WHERE user_id = ?1",
            params![user_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn scheduler_status(state: State<'_, SchedulerState>) -> Result<SchedulerStatus, String> {
    let connection = open_database(&state.database_path)?;
    let pending_jobs = connection
        .query_row(
            "SELECT COUNT(*) FROM notification_jobs WHERE state = 'pending'",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    Ok(SchedulerStatus {
        pending_jobs,
        database_path: state.database_path.display().to_string(),
    })
}

fn read_due_jobs(connection: &Connection, now: i64) -> Result<Vec<NotificationJob>, String> {
    let mut statement = connection
        .prepare(
            "SELECT job_id, reminder_id, kind, title, body, sound, fire_at
             FROM notification_jobs
             WHERE state = 'pending' AND fire_at <= ?1
             ORDER BY fire_at ASC
             LIMIT 50",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![now], |row| {
            Ok(NotificationJob {
                job_id: row.get(0)?,
                reminder_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                body: row.get(4)?,
                sound: row.get(5)?,
                fire_at: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn show_native_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    play_default_sound: bool,
) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification.summary(title).body(body);

    if play_default_sound {
        notification.sound_name("Default");
    }

    #[cfg(windows)]
    notification.app_id(&app.config().identifier);

    notification
        .show()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn send_test_notification(app: AppHandle) -> Result<(), String> {
    show_native_notification(
        &app,
        "Nexo — teste de notificação",
        "Tudo certo! Os alertas deste computador estão funcionando.",
        true,
    )
}

fn dispatch_due_jobs(app: &AppHandle, database_path: &Path) -> Result<(), String> {
    let now = Utc::now().timestamp_millis();
    let connection = open_database(database_path)?;
    let jobs = read_due_jobs(&connection, now)?;

    for job in jobs {
        if now - job.fire_at > LATE_NOTIFICATION_GRACE_MS {
            connection
                .execute(
                    "UPDATE notification_jobs SET state = 'fired', fired_at = ?1
                     WHERE job_id = ?2 AND state = 'pending'",
                    params![now, job.job_id],
                )
                .map_err(|error| error.to_string())?;
            continue;
        }

        let native_sound = job.sound.trim().is_empty() || job.sound == "padrão";
        if let Err(error) = show_native_notification(
            app,
            &format!("Nexo: {}", job.title),
            &job.body,
            native_sound,
        ) {
            eprintln!("Failed to show Nexo notification: {error}");
            continue;
        }

        let changed = connection
            .execute(
                "UPDATE notification_jobs
                 SET state = 'fired', fired_at = ?1
                 WHERE job_id = ?2 AND state = 'pending'",
                params![now, job.job_id],
            )
            .map_err(|error| error.to_string())?;

        if changed == 0 {
            continue;
        }

        let _ = app.emit(
            "nexo-reminder-fired",
            ReminderFiredPayload {
                reminder_id: job.reminder_id,
                kind: job.kind,
                sound: job.sound,
                native_sound,
                fire_at: job.fire_at,
            },
        );
    }

    Ok(())
}

fn start_scheduler(app: AppHandle, database_path: PathBuf) {
    thread::spawn(move || {
        // Give the WebView time to attach its event listener on startup. Native
        // notifications still fire independently if the window remains hidden.
        thread::sleep(Duration::from_secs(5));
        loop {
            if let Err(error) = dispatch_due_jobs(&app, &database_path) {
                eprintln!("Nexo scheduler error: {error}");
            }
            thread::sleep(Duration::from_secs(2));
        }
    });
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn is_valid_oauth_callback(url: &Url) -> bool {
    url.scheme() == "nexo" && url.host_str() == Some("auth") && url.path() == "/callback"
}

fn queue_oauth_callbacks(app: &AppHandle, urls: &[Url]) {
    let callbacks = urls
        .iter()
        .filter(|url| is_valid_oauth_callback(url))
        .map(Url::to_string)
        .collect::<Vec<_>>();

    if callbacks.is_empty() {
        return;
    }

    let state = app.state::<OAuthCallbackState>();
    match state.pending.lock() {
        Ok(mut pending) => pending.extend(callbacks),
        Err(error) => {
            eprintln!("Failed to store Nexo OAuth callback: {error}");
            return;
        }
    }

    show_main_window(app);
    let _ = app.emit("nexo-oauth-callback-available", ());
}

#[tauri::command]
fn take_oauth_callbacks(state: State<'_, OAuthCallbackState>) -> Result<Vec<String>, String> {
    let mut pending = state.pending.lock().map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn open_oauth_url(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "URL de autenticação inválida".to_string())?;
    let valid_origin = parsed.scheme() == "https"
        && parsed.host_str() == Some(SUPABASE_AUTH_HOST)
        && parsed.path() == "/auth/v1/authorize";

    let mut google_provider = false;
    let mut valid_callback = false;
    for (key, value) in parsed.query_pairs() {
        if key == "provider" && value == "google" {
            google_provider = true;
        }
        if key == "redirect_to" && value.starts_with(OAUTH_CALLBACK_URL) {
            valid_callback = true;
        }
    }

    if !valid_origin || !google_provider || !valid_callback {
        return Err("O Nexo recusou uma URL de autenticação não autorizada".to_string());
    }

    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| error.to_string())
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Abrir Nexo", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair do Nexo", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let mut tray_builder = TrayIconBuilder::with_id("nexo-tray")
        .tooltip("Nexo — seus lembretes")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window(app),
            "quit" => {
                ALLOW_EXIT.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app.manage(OAuthCallbackState::default());

            if let Some(urls) = app.deep_link().get_current()? {
                queue_oauth_callbacks(app.handle(), &urls);
            }

            let oauth_app = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                queue_oauth_callbacks(&oauth_app, &event.urls());
            });

            let app_data_directory = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_directory)?;
            let database_path = app_data_directory.join("nexo-desktop.sqlite3");
            initialize_database(&database_path)
                .map_err(|error| format!("failed to initialize scheduler database: {error}"))?;

            app.manage(SchedulerState {
                database_path: database_path.clone(),
            });
            setup_tray(app)?;
            start_scheduler(app.handle().clone(), database_path);

            let started_hidden = std::env::args().any(|argument| argument == "--hidden");
            if !started_hidden {
                show_main_window(app.handle());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sync_reminders,
            upsert_reminder,
            remove_reminder,
            clear_reminders,
            scheduler_status,
            send_test_notification,
            take_oauth_callbacks,
            open_oauth_url
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Nexo");
}
