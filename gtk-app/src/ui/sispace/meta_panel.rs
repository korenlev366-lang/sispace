use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use adw::prelude::*;
use adw::EntryRow;
use gtk::prelude::{BoxExt, ButtonExt, WidgetExt};
use gtk::{
    Box, Button, DropDown, Label, Orientation, ScrolledWindow, StringList, Widget,
};
use serde_json::Value;
use sispace_core::services::pane::PaneManager;

use super::pane_events::{is_meta_feed_channel, pane_id_from_payload, summarize_pane_event};
use super::terminal_column::TerminalColumn;

const MAX_FEED_LINES: usize = 500;

/// Meta-orchestrator: read-only event feed, inject entry, target pane dropdown.
pub struct MetaPanel {
    root: Box,
    feed_scroll: ScrolledWindow,
    feed_box: Box,
    target_dropdown: DropDown,
    prompt_entry: EntryRow,
    error_label: Label,
    pane_manager: Arc<PaneManager>,
    _column: Rc<RefCell<TerminalColumn>>,
    target_pane: RefCell<Option<String>>,
}

impl MetaPanel {
    pub fn new(pane_manager: Arc<PaneManager>, column: Rc<RefCell<TerminalColumn>>) -> Self {
        let root = Box::new(Orientation::Vertical, 8);
        root.add_css_class("meta-panel-frame");
        root.add_css_class("orch-panel");
        root.set_margin_top(8);
        root.set_margin_start(8);
        root.set_margin_end(8);
        root.set_margin_bottom(8);

        let heading = Label::new(Some("Meta-orchestrator"));
        heading.add_css_class("title-4");
        heading.add_css_class("cursorsi-brand");
        heading.add_css_class("orch-title");
        root.append(&heading);

        let sub = Label::new(Some(
            "Structured pane IPC │ inject to one pane or broadcast all",
        ));
        sub.set_wrap(true);
        sub.add_css_class("dim-label");
        sub.add_css_class("orch-sub");
        root.append(&sub);

        // Log feed: vertical Box of Labels inside a ScrolledWindow
        let feed_box = Box::new(Orientation::Vertical, 0);
        feed_box.add_css_class("orch-log");

        let feed_scroll = ScrolledWindow::builder()
            .min_content_height(120)
            .vexpand(false)
            .hexpand(true)
            .build();
        feed_scroll.set_child(Some(&feed_box));
        root.append(&feed_scroll);

        let target_dropdown = DropDown::new(None::<StringList>, None::<gtk::Expression>);
        target_dropdown.set_enable_search(false);

        let target_box = Box::new(Orientation::Horizontal, 8);
        let target_lbl = Label::new(Some("Target pane"));
        target_lbl.set_halign(gtk::Align::Start);
        target_box.append(&target_lbl);
        target_box.append(&target_dropdown);
        root.append(&target_box);

        let prompt_entry = EntryRow::new();
        prompt_entry.set_title("Prompt");
        prompt_entry.set_show_apply_button(false);
        prompt_entry.add_css_class("orch-prompt");
        root.append(&prompt_entry);

        let error_label = Label::new(None);
        error_label.add_css_class("error");
        error_label.set_wrap(true);
        error_label.set_visible(false);
        root.append(&error_label);

        let actions = Box::new(Orientation::Horizontal, 8);
        actions.set_homogeneous(true);
        actions.add_css_class("orch-actions");
        let send_btn = Button::with_label("Send to pane");
        send_btn.add_css_class("cursorsi-action");
        send_btn.set_hexpand(true);
        let broadcast_btn = Button::with_label("Broadcast all");
        broadcast_btn.add_css_class("cursorsi-action");
        broadcast_btn.set_hexpand(true);
        actions.append(&send_btn);
        actions.append(&broadcast_btn);
        root.append(&actions);

        let panel = Self {
            root,
            feed_scroll,
            feed_box,
            target_dropdown,
            prompt_entry,
            error_label,
            pane_manager,
            _column: column,
            target_pane: RefCell::new(None),
        };

        panel.wire_target_dropdown();
        panel.wire_inject_buttons(send_btn, broadcast_btn);
        panel.refresh_pane_dropdown(None);
        panel
    }

    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }

    pub fn refresh_pane_dropdown(&self, select_pane: Option<&str>) {
        let panes = self.pane_manager.list();
        let labels: Vec<String> = panes
            .iter()
            .map(|p| format!("{} ({})", p.title, p.status))
            .collect();
        let refs: Vec<&str> = labels.iter().map(|s| s.as_str()).collect();
        let new_list = StringList::new(&refs);
        self.target_dropdown.set_model(Some(&new_list));

        if let Some(pid) = select_pane {
            if let Some(idx) = panes.iter().position(|p| p.id == pid) {
                self.target_dropdown.set_selected(idx as u32);
                *self.target_pane.borrow_mut() = Some(pid.to_string());
            }
        } else if let Some(first) = panes.first() {
            self.target_dropdown.set_selected(0);
            *self.target_pane.borrow_mut() = Some(first.id.clone());
        }
    }

    pub fn append_feed(&self, channel: &str, payload: &Value) {
        if !is_meta_feed_channel(channel) {
            return;
        }
        let pane_id = pane_id_from_payload(payload).unwrap_or_else(|| "?".to_string());
        let title = self
            .pane_manager
            .get(&pane_id)
            .map(|p| p.title)
            .unwrap_or(pane_id);
        let event_type = payload
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or(channel);
        let ts = payload
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() >= 19 {
                    s[11..19].to_string()
                } else {
                    s.to_string()
                }
            })
            .unwrap_or_else(|| "--:--:--".to_string());
        let summary = summarize_pane_event(payload);
        let line = format!("[{ts}] {title} · {event_type} · {summary}");

        let label = Label::new(Some(&line));
        label.set_ellipsize(gtk::pango::EllipsizeMode::End);
        label.set_halign(gtk::Align::Fill);
        label.set_xalign(0.0);
        label.set_selectable(true);
        self.feed_box.append(&label);

        // Trim oldest lines if over the cap
        loop {
            let mut count = 0usize;
            let mut child = self.feed_box.first_child();
            while let Some(c) = child {
                count += 1;
                child = c.next_sibling();
            }
            if count <= MAX_FEED_LINES {
                break;
            }
            if let Some(first) = self.feed_box.first_child() {
                self.feed_box.remove(&first);
            } else {
                break;
            }
        }

        // Scroll to bottom (deferred so layout settles)
        let vadj = self.feed_scroll.vadjustment();
        gtk::glib::idle_add_local_once(move || {
            vadj.set_value(vadj.upper() - vadj.page_size());
        });
    }

    fn wire_target_dropdown(&self) {
        let panes = Arc::clone(&self.pane_manager);
        let target = Rc::new(RefCell::new(None::<String>));
        *target.borrow_mut() = self.target_pane.borrow().clone();
        self.target_dropdown.connect_selected_notify(move |dropdown| {
            let idx = dropdown.selected();
            if idx == gtk::INVALID_LIST_POSITION {
                return;
            }
            if let Some(pane) = panes.list().get(idx as usize) {
                *target.borrow_mut() = Some(pane.id.clone());
            }
        });
    }

    fn wire_inject_buttons(&self, send_btn: Button, broadcast_btn: Button) {
        let pane_manager = Arc::clone(&self.pane_manager);
        let entry = self.prompt_entry.clone();
        let error = self.error_label.clone();
        let target_dd = self.target_dropdown.clone();
        let panes_mgr = Arc::clone(&self.pane_manager);

        send_btn.connect_clicked(move |_| {
            error.set_visible(false);
            let text = entry.text().trim().to_string();
            if text.is_empty() {
                error.set_text("Enter a prompt to inject.");
                error.set_visible(true);
                return;
            }
            let idx = target_dd.selected();
            let pane_id = panes_mgr
                .list()
                .get(idx as usize)
                .map(|p| p.id.clone());
            match pane_id {
                Some(pid) => {
                    if let Err(e) = panes_mgr.inject_prompt(&pid, &text) {
                        error.set_text(&e);
                        error.set_visible(true);
                    } else {
                        entry.set_text("");
                    }
                }
                None => {
                    error.set_text("Select a target pane.");
                    error.set_visible(true);
                }
            }
        });

        let pane_manager_bc = Arc::clone(&pane_manager);
        let entry_bc = self.prompt_entry.clone();
        let error_bc = self.error_label.clone();
        broadcast_btn.connect_clicked(move |_| {
            error_bc.set_visible(false);
            let text = entry_bc.text().trim().to_string();
            if text.is_empty() {
                error_bc.set_text("Enter a prompt to inject.");
                error_bc.set_visible(true);
                return;
            }
            let mut err: Option<String> = None;
            for pane in pane_manager_bc.list() {
                if let Err(e) = pane_manager_bc.inject_prompt(&pane.id, &text) {
                    err = Some(e);
                }
            }
            if let Some(e) = err {
                error_bc.set_text(&e);
                error_bc.set_visible(true);
            } else {
                entry_bc.set_text("");
            }
        });
    }
}
