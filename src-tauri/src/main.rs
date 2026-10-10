// Empêche l'ouverture d'une console sous Windows en mode release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    magic_wallpaper_lib::run()
}
