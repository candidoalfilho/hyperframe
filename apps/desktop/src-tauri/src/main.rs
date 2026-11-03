#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Chave pública do Aptabase (telemetria ANÔNIMA: 1 evento por abertura com
/// versão do app e SO — nunca projetos nem dados pessoais; ver README
/// «Telemetria» e src/telemetry.ts). Vazia = plugin nem registra e o build
/// não envia nada.
const APTABASE_APP_KEY: &str = "A-EU-0395565779";

fn main() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());
    if !APTABASE_APP_KEY.is_empty() {
        builder = builder.plugin(tauri_plugin_aptabase::Builder::new(APTABASE_APP_KEY).build());
    }
    builder
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o HyperFrame");
}
