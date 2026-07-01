use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::{Dialog, EntryRow};
use gtk::prelude::{BoxExt, ButtonExt, WidgetExt};
use gtk::{
    Box, Button, Label, ListBox, ListBoxRow, Orientation, ScrolledWindow, Window,
};
use sispace_core::services::node_host::project_root;
use sispace_core::services::pane_ipc::PaneIpcContext;
use sispace_core::services::workspace::{
    apply_preset_for_vte, delete_preset, ensure_default_presets, layout_from_panes,
    list_presets, save_preset_layout,
};
use sispace_core::state::AppState;

use crate::ui::sispace::{SispacePaneUi, TerminalColumn};

pub struct PresetsDialog {
    dialog: Dialog,
    list: ListBox,
    status: Label,
    name_entry: EntryRow,
    state: Arc<AppState>,
    ipc_ctx: PaneIpcContext,
    column: Rc<RefCell<TerminalColumn>>,
    ui: Rc<SispacePaneUi>,
}

impl PresetsDialog {
    pub fn new(
        state: Arc<AppState>,
        ipc_ctx: PaneIpcContext,
        column: Rc<RefCell<TerminalColumn>>,
        ui: Rc<SispacePaneUi>,
    ) -> Rc<Self> {
        let dialog = Dialog::new();

        let content = Box::new(Orientation::Vertical, 12);
        content.set_margin_top(12);
        content.set_margin_bottom(12);
        content.set_margin_start(12);
        content.set_margin_end(12);

        let heading = Label::new(Some("Workspace presets"));
        heading.add_css_class("title-2");
        content.append(&heading);

        let hint = Label::new(Some(
            "Pick a preset to spawn VTE panes, or save the current column (SQLite workspace_presets).",
        ));
        hint.set_wrap(true);
        hint.add_css_class("dim-label");
        content.append(&hint);

        let list_scroll = ScrolledWindow::builder()
            .min_content_height(180)
            .build();
        list_scroll.set_policy(gtk::PolicyType::Never, gtk::PolicyType::Automatic);
        let list = ListBox::new();
        list.add_css_class("boxed-list");
        list_scroll.set_child(Some(&list));
        content.append(&list_scroll);

        let name_entry = EntryRow::builder()
            .title("Preset name")
            .text("my-layout")
            .build();
        content.append(&name_entry);

        let actions = Box::new(Orientation::Horizontal, 8);
        let apply_btn = Button::with_label("Apply selected");
        apply_btn.add_css_class("suggested-action");
        let save_btn = Button::with_label("Save current");
        let delete_btn = Button::with_label("Delete");
        let refresh_btn = Button::with_label("Refresh");
        for b in [&apply_btn, &save_btn, &delete_btn, &refresh_btn] {
            actions.append(b);
        }
        content.append(&actions);

        let status = Label::new(None);
        status.set_wrap(true);
        status.add_css_class("dim-label");
        content.append(&status);

        dialog.set_child(Some(&content));

        let this = Rc::new(Self {
            dialog,
            list,
            status,
            name_entry,
            state,
            ipc_ctx,
            column,
            ui,
        });

        let p = Rc::clone(&this);
        refresh_btn.connect_clicked(move |_| {
            p.reload_list();
        });

        let p = Rc::clone(&this);
        apply_btn.connect_clicked(move |_| {
            p.apply_selected();
        });

        let p = Rc::clone(&this);
        save_btn.connect_clicked(move |_| {
            p.save_current();
        });

        let p = Rc::clone(&this);
        delete_btn.connect_clicked(move |_| {
            p.delete_selected();
        });

        this
    }

    pub fn present(&self, parent: Option<&Window>) {
        let root = project_root().to_string_lossy().into_owned();
        if let Err(e) = ensure_default_presets(&self.state, &root) {
            self.status.set_text(&format!("Defaults: {e}"));
        }
        self.reload_list();
        self.dialog.present(parent);
    }

    fn reload_list(&self) {
        while let Some(row) = self.list.first_child() {
            self.list.remove(&row);
        }

        match list_presets(&self.state) {
            Ok(presets) => {
                if presets.is_empty() {
                    let row = ListBoxRow::new();
                    let label = Label::new(Some("No presets saved yet."));
                    label.add_css_class("dim-label");
                    row.set_child(Some(&label));
                    self.list.append(&row);
                } else {
                    for preset in presets {
                        let row = ListBoxRow::new();
                        let box_row = Box::new(Orientation::Vertical, 2);
                        let title = Label::new(Some(&preset.name));
                        title.set_halign(gtk::Align::Start);
                        title.add_css_class("heading");
                        let meta = Label::new(Some(&format!(
                            "updated {}",
                            preset.updated_at
                        )));
                        meta.set_halign(gtk::Align::Start);
                        meta.add_css_class("dim-label");
                        box_row.append(&title);
                        box_row.append(&meta);
                        row.set_child(Some(&box_row));
                        row.set_widget_name(&preset.name);
                        self.list.append(&row);
                    }
                }
                self.status.set_text("");
            }
            Err(e) => {
                self.status.set_text(&format!("Load failed: {e}"));
            }
        }
    }

    fn selected_name(&self) -> Option<String> {
        let row = self.list.selected_row()?;
        let name = row.widget_name();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    fn apply_selected(&self) {
        let Some(name) = self.selected_name() else {
            self.status.set_text("Select a preset from the list first.");
            return;
        };
        self.column.borrow().clear_attached();
        match apply_preset_for_vte(&self.ipc_ctx, &self.state, &name) {
            Ok(infos) => {
                if let Err(e) = self.column.borrow().attach_panes_and_focus_last(&infos) {
                    self.status.set_text(&e);
                    return;
                }
                for info in &infos {
                    self.ui.on_pane_spawned(&info.id);
                }
                self.status.set_text(&format!("Applied preset “{name}” ({} panes).", infos.len()));
                self.dialog.close();
            }
            Err(e) => self.status.set_text(&format!("Apply failed: {e}")),
        }
    }

    fn save_current(&self) {
        let name = self.name_entry.text().trim().to_string();
        if name.is_empty() {
            self.status.set_text("Enter a preset name.");
            return;
        }
        let panes = self.state.pane_manager.list();
        if panes.is_empty() {
            self.status.set_text("Spawn at least one pane before saving.");
            return;
        }
        let layout = layout_from_panes(&panes);
        match save_preset_layout(&self.state, &name, &layout) {
            Ok(_) => {
                self.status.set_text(&format!("Saved preset “{name}”."));
                self.reload_list();
            }
            Err(e) => self.status.set_text(&format!("Save failed: {e}")),
        }
    }

    fn delete_selected(&self) {
        let Some(name) = self.selected_name() else {
            self.status.set_text("Select a preset to delete.");
            return;
        };
        match delete_preset(&self.state, &name) {
            Ok(true) => {
                self.status.set_text(&format!("Deleted “{name}”."));
                self.reload_list();
            }
            Ok(false) => self.status.set_text("Preset not found."),
            Err(e) => self.status.set_text(&format!("Delete failed: {e}")),
        }
    }
}
