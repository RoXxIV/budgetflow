// BudgetFlow2 — coquille Tauri autour du backend Node (sidecar) + frontend Vue embarqué.
//
// Séquence de démarrage :
//   1. base : %APPDATA%/fr.revaw.budgetflow2/budget.db — copiée depuis la seed embarquée
//      au premier lancement (les migrations s'appliquent ensuite au boot du backend) ;
//   2. spawn de `node server.js` (node du système) sur le port 3004 — l'ancienne app
//      installée occupe 3001/3002 et le dev 3003/5174 : aucune collision ;
//   3. on attend que le port réponde avant d'ouvrir la fenêtre (pas de page vide) ;
//   4. à la fermeture, le backend est tué (pas de node orphelin).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, RunEvent};

const BACKEND_PORT: u16 = 3004;

struct Backend(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let resources = app.path().resource_dir().expect("resource_dir");
            let data_dir = app.path().app_data_dir().expect("app_data_dir");
            std::fs::create_dir_all(&data_dir)?;

            // Premier lancement : la base seed (données au moment du build) devient la base de l'app
            let db_path = data_dir.join("budget.db");
            if !db_path.exists() {
                for f in ["budget.db", "budget.db-wal", "budget.db-shm"] {
                    let src = resources.join("seed").join(f);
                    if src.exists() {
                        std::fs::copy(&src, data_dir.join(f))?;
                    }
                }
            }

            // Sidecar : node du système (l'app est personnelle, node 22+ est installé)
            let server = resources.join("backend").join("server.js");
            let mut cmd = Command::new("node");
            cmd.arg(&server)
                .env("PORT", BACKEND_PORT.to_string())
                .env("DB_PATH", &db_path)
                .current_dir(resources.join("backend"));
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console qui clignote
            }
            let child = cmd.spawn().expect(
                "Impossible de lancer le backend : node est-il installé et dans le PATH ?",
            );
            app.manage(Backend(Mutex::new(Some(child))));

            // La fenêtre n'ouvre que quand l'API répond (15 s max)
            for _ in 0..150 {
                if TcpStream::connect(("127.0.0.1", BACKEND_PORT)).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }

            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("BudgetFlow")
                .inner_size(1440.0, 920.0)
                .min_inner_size(1000.0, 700.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au lancement de BudgetFlow2")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(backend) = app.try_state::<Backend>() {
                    if let Some(mut child) = backend.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
