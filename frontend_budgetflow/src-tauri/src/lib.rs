use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// Garde le handle du backend vivant tant que l'app tourne.
// Quand l'app se ferme, le Mutex est droppé → le process backend est tué.
pub struct BackendProcess(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let sidecar = app.shell().sidecar("backend")?;
            let (_rx, child) = sidecar.spawn()?;
            *app.state::<BackendProcess>().0.lock().unwrap() = Some(child);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Erreur lors du démarrage de l'application");
}
