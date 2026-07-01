use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use adw::{Dialog, EntryRow};
use gtk::prelude::{BoxExt, ButtonExt, WidgetExt};
use gtk::{Box, Button, Label, Orientation, Window};

use super::sispace_ui::SispacePaneUi;
use super::terminal_column::TerminalColumn;

/// Dialog that asks for a working directory path and spawns a terminal at that path.
pub struct SpawnDialog {
    dialog: Dialog,
    entry: EntryRow,
    status: Label,
    column: Rc<RefCell<TerminalColumn>>,
    ui: Rc<SispacePaneUi>,
    spawn_callback: RefCell<Option<Rc<dyn Fn(&str)>>>,
}

impl SpawnDialog {
    pub fn new(
        initial_path: &str,
        column: Rc<RefCell<TerminalColumn>>,
        ui: Rc<SispacePaneUi>,
    ) -> Rc<Self> {
        let dialog = Dialog::new();
        dialog.set_title("Spawn terminal");

        let content = Box::new(Orientation::Vertical, 12);
        content.set_margin_top(12);
        content.set_margin_bottom(12);
        content.set_margin_start(12);
        content.set_margin_end(12);

        let heading = Label::new(Some("Working directory"));
        heading.add_css_class("title-2");
        content.append(&heading);

        let hint = Label::new(Some("Enter the absolute path where the terminal should start."));
        hint.set_wrap(true);
        hint.add_css_class("dim-label");
        content.append(&hint);

        let entry = EntryRow::builder()
            .title("Path")
            .text(initial_path)
            .build();
        entry.set_activates_default(true);
        content.append(&entry);

        let actions = Box::new(Orientation::Horizontal, 8);
        let cancel_btn = Button::with_label("Cancel");
        let spawn_btn = Button::with_label("Spawn");
        spawn_btn.add_css_class("suggested-action");
        spawn_btn.set_hexpand(true);
        actions.append(&cancel_btn);
        actions.append(&spawn_btn);
        content.append(&actions);

        let status = Label::new(None);
        status.set_wrap(true);
        status.add_css_class("dim-label");
        status.set_visible(false);
        content.append(&status);

        dialog.set_child(Some(&content));

        let this = Rc::new(Self {
            dialog,
            entry,
            status,
            column,
            ui,
            spawn_callback: RefCell::new(None),
        });

        // Cancel closes the dialog
        let d_cancel = Rc::clone(&this);
        cancel_btn.connect_clicked(move |_| {
            d_cancel.dialog.close();
        });

        // Spawn validates the path and spawns a terminal
        let d_spawn = Rc::clone(&this);
        spawn_btn.connect_clicked(move |_| {
            d_spawn.do_spawn();
        });

        this
    }

    /// Update the path entry text (e.g. when the toolbar entry changed since last open).
    pub fn set_entry_text(&self, text: &str) {
        self.entry.set_text(text);
    }

    /// Register a callback that fires after a successful spawn (for UI swap, count refresh).
    pub fn on_spawn_callback(&self, cb: Rc<dyn Fn(&str)>) {
        *self.spawn_callback.borrow_mut() = Some(cb);
    }

    pub fn present(&self, parent: Option<&Window>) {
        self.status.set_visible(false);
        self.entry.grab_focus();
        self.dialog.present(parent);
    }

    fn do_spawn(&self) {
        let raw = self.entry.text().trim().to_string();
        if raw.is_empty() {
            self.status.set_text("Path cannot be empty.");
            self.status.set_visible(true);
            return;
        }

        let path = std::path::Path::new(&raw);
        if !path.is_dir() {
            self.status.set_text(&format!("Not a valid directory: {raw}"));
            self.status.set_visible(true);
            return;
        }

        let result = {
            let col = self.column.borrow();
            col.spawn_and_focus(&raw)
        };
        match result {
            Ok(info) => {
                self.ui.on_pane_spawned(&info.id);
                if let Some(cb) = self.spawn_callback.borrow().as_ref() {
                    cb(&info.id);
                }
                self.dialog.close();
            }
            Err(err) => {
                self.status.set_text(&err);
                self.status.set_visible(true);
            }
        }
    }
}