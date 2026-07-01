//! Clipboard paste and copy shortcuts for embedded VTE panes.
//!
//! Without this, Ctrl+V is forwarded to the PTY as a bare `v` key and Ink appends
//! a single letter instead of pasting clipboard contents.
//!
//! VTE also maps Shift+Ctrl+C to the same `\x03` as Ctrl+C, which makes cursorsi
//! quit instead of copy. We intercept Shift+Ctrl+C and inject an xterm-style
//! modified-key sequence that cursorsi recognizes (`isShiftCtrlCRaw`).

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use gtk::gdk;
use gtk::gio;
use gtk::glib;
use gtk::prelude::*;
use vte4::prelude::*;
use vte4::{Format, Terminal};

fn is_paste_key(key: gdk::Key, state: gdk::ModifierType) -> bool {
    let ctrl = state.contains(gdk::ModifierType::CONTROL_MASK);
    if ctrl && matches!(key, gdk::Key::v | gdk::Key::V) {
        return true;
    }
    state.contains(gdk::ModifierType::SHIFT_MASK) && key == gdk::Key::Insert
}

fn is_copy_key(key: gdk::Key, state: gdk::ModifierType) -> bool {
    let ctrl = state.contains(gdk::ModifierType::CONTROL_MASK);
    let shift = state.contains(gdk::ModifierType::SHIFT_MASK);
    ctrl && shift && matches!(key, gdk::Key::c | gdk::Key::C)
}

/// xterm modifyOtherKeys-style Ctrl+Shift+C (see cli `isShiftCtrlCRaw`).
const COPY_KEY_SEQUENCE: &[u8] = b"\x1b[27;6;99~";

fn feed_copy_shortcut(terminal: &Terminal) {
    terminal.feed_child(COPY_KEY_SEQUENCE);
}

/// Deferred copy of terminal selection to system clipboard.
///
/// Called from a key-pressed handler; deferring via `idle_add_local_once` prevents
/// GTK main-loop reentrancy, which can crash if `copy_clipboard_format` triggers
/// Wayland IPC roundtrips that process pending events and mutate terminal state.
fn deferred_copy_terminal_to_clipboard(terminal: &Terminal) {
    let term = terminal.clone();
    glib::idle_add_local_once(move || {
        if gdk::Display::default().is_none() {
            return; // no display (headless or shutting down) — skip
        }
        let had_selection = term.has_selection();
        if !had_selection {
            term.select_all();
        }
        term.copy_clipboard_format(Format::Text);
        if !had_selection {
            term.unselect_all();
        }
    });
}

fn save_texture_to_temp_path(texture: &gdk::Texture) -> Option<std::path::PathBuf> {
    let bytes = texture.save_to_png_bytes();
    if bytes.is_empty() {
        return None;
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis();
    let path = std::env::temp_dir().join(format!("sispace-paste-{stamp}.png"));
    fs::write(&path, bytes.as_ref()).ok()?;
    Some(path)
}

fn looks_like_binary_paste(text: &str) -> bool {
    if text.contains('\0') {
        return true;
    }
    let head: Vec<u8> = text.bytes().take(4096).collect();
    if head.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return true;
    }
    if head.len() >= 3 && head[0] == 0xff && head[1] == 0xd8 && head[2] == 0xff {
        return true;
    }
    if text.starts_with("PNG") && text.contains("IHDR") {
        return true;
    }
    let control = head
        .iter()
        .filter(|&&b| b < 32 && b != b'\t' && b != b'\n' && b != b'\r')
        .count();
    !head.is_empty() && (control * 100 / head.len()) > 8
}

fn feed_paste_text(terminal: &Terminal, text: &str) {
    if text.is_empty() || looks_like_binary_paste(text) {
        return;
    }
    terminal.paste_text(text);
}

/// Intercept paste/copy shortcuts before VTE normalizes them for the PTY.
pub fn install_vte_paste_bindings(terminal: &Terminal) {
    let controller = gtk::EventControllerKey::new();
    let term = terminal.clone();
    controller.connect_key_pressed(move |_ctrl, key, _keycode, state| {
        if is_copy_key(key, state) {
            // Feed the shortcut synchronously (just writes bytes to the PTY fd, no GTK).
            feed_copy_shortcut(&term);
            // Gdk clipboard deferred to idle to prevent main-loop reentrancy
            // (wl-copy from the PTY child is unreliable on Wayland).
            deferred_copy_terminal_to_clipboard(&term);
            return glib::Propagation::Stop;
        }
        if !is_paste_key(key, state) {
            return glib::Propagation::Proceed;
        }
        paste_from_clipboard(&term);
        glib::Propagation::Stop
    });
    terminal.add_controller(controller);
}

fn paste_from_clipboard(terminal: &Terminal) {
    let display = gtk::gdk::Display::default();
    let Some(display) = display else {
        terminal.paste_clipboard();
        return;
    };
    let clipboard = display.clipboard();
    let term = terminal.clone();
    let clip = clipboard.clone();
    clipboard.read_texture_async(
        None::<&gio::Cancellable>,
        move |result| {
            if let Ok(Some(texture)) = result {
                if let Some(path) = save_texture_to_temp_path(&texture) {
                    let line = format!("@{}", path.display());
                    feed_paste_text(&term, &line);
                    return;
                }
            }
            let term2 = term.clone();
            clip.read_text_async(
                None::<&gio::Cancellable>,
                move |text_result| {
                    if let Ok(Some(text)) = text_result {
                        feed_paste_text(&term2, &text);
                        return;
                    }
                    term2.paste_clipboard();
                },
            );
        },
    );
}
