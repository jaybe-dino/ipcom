// REMIX HUB desktop shell. The entire UI is the shared web client, loaded by
// Tauri's webview; no platform-specific UI code is needed here.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running REMIX HUB desktop");
}
