use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use gtk::glib;
use gtk::prelude::*;
use gtk::prelude::ButtonExt;
use gtk::{Align, Box, Button, Label, ListBox, ListBoxRow, Orientation, ScrolledWindow};
use serde_json::Value;
use sispace_core::services::pane::{PaneInfo, PaneManager};

use super::pane_events::{format_token_count, event_type_from_payload, pane_id_from_payload};
use super::terminal_column::TerminalColumn;

#[derive(Clone, Default)]
struct SessionLive {
    agent_status: &'static str,
    session_tokens: i64,
    current_task: Option<String>,
}

struct SessionRow {
    row: ListBoxRow,
    card: Box,
    name_label: Label,
    run_dot: Label,
    stats_label: Label,
    #[allow(dead_code)]
    delete_btn: Button,
    live: SessionLive,
}

/// GtkListBox of cursorsi sessions with live IPC-driven status.
pub struct SessionSidebar {
    root: ScrolledWindow,
    list: ListBox,
    rows: RefCell<HashMap<String, SessionRow>>,
    pane_manager: Arc<PaneManager>,
    column: Rc<RefCell<TerminalColumn>>,
    active_pane: RefCell<Option<String>>,
    close_handler: Rc<RefCell<Option<Rc<dyn Fn(String)>>>>,
    in_rebuild: Rc<Cell<bool>>,
}

impl SessionSidebar {
    pub fn new(pane_manager: Arc<PaneManager>, column: Rc<RefCell<TerminalColumn>>) -> Self {
        let list = ListBox::new();
        list.add_css_class("navigation-sidebar");
        list.set_selection_mode(gtk::SelectionMode::None);

        let scroll = ScrolledWindow::builder()
            .vexpand(true)
            .hexpand(true)
            .build();
        scroll.set_size_request(220, 0);
        scroll.set_propagate_natural_width(false);
        scroll.set_policy(gtk::PolicyType::Never, gtk::PolicyType::Automatic);
        list.set_size_request(220, -1);
        scroll.set_child(Some(&list));

        let in_rebuild = Rc::new(Cell::new(false));

        let sidebar = Self {
            root: scroll,
            list,
            rows: RefCell::new(HashMap::new()),
            pane_manager,
            column,
            active_pane: RefCell::new(None),
            close_handler: Rc::new(RefCell::new(None)),
            in_rebuild: Rc::clone(&in_rebuild),
        };

        sidebar.wire_selection(Rc::clone(&in_rebuild));
        sidebar
    }

    pub fn widget(&self) -> &ScrolledWindow {
        &self.root
    }

    pub fn set_close_handler(&self, handler: Rc<dyn Fn(String)>) {
        *self.close_handler.borrow_mut() = Some(handler);
    }

    fn begin_rebuild(&self) -> bool {
        if self.in_rebuild.get() {
            return false;
        }
        self.in_rebuild.set(true);
        self.list.set_selection_mode(gtk::SelectionMode::None);
        true
    }

    fn end_rebuild(&self) {
        let list = self.list.clone();
        let in_rebuild = Rc::clone(&self.in_rebuild);
        glib::idle_add_local_once(move || {
            if list.root().is_some() {
                list.set_selection_mode(gtk::SelectionMode::Single);
            }
            let in_rebuild_late = Rc::clone(&in_rebuild);
            glib::idle_add_local_once(move || {
                in_rebuild_late.set(false);
            });
        });
    }

    pub fn remove_pane(&self, pane_id: &str) {
        if !self.begin_rebuild() {
            return;
        }
        let mut rows = self.rows.borrow_mut();
        if let Some(row) = rows.remove(pane_id) {
            self.list.remove(&row.row);
        }
        if self.active_pane.borrow().as_deref() == Some(pane_id) {
            *self.active_pane.borrow_mut() = None;
        }
        self.end_rebuild();
    }

    pub fn sync_from_manager(&self) {
        if !self.begin_rebuild() {
            return;
        }
        for pane in self.pane_manager.list() {
            // upsert_pane_inner does NOT check for existing rows; skip panes that
            // already have a sidebar row to prevent duplicate session trackers.
            if !self.rows.borrow().contains_key(&pane.id) {
                self.upsert_pane_inner(&pane);
            }
        }
        self.end_rebuild();
    }

    pub fn upsert_pane(&self, info: &PaneInfo) {
        if self.rows.borrow().contains_key(&info.id) {
            self.update_pane_row(info);
            return;
        }
        if !self.begin_rebuild() {
            return;
        }
        self.upsert_pane_inner(info);
        self.end_rebuild();
    }

    fn update_pane_row(&self, info: &PaneInfo) {
        let mut rows = self.rows.borrow_mut();
        if let Some(row) = rows.get_mut(&info.id) {
            row.name_label.set_text(&info.title);
            row.live.agent_status = agent_status_label(&info.agent_status);
            row.live.session_tokens = info.session_tokens;
            row.live.current_task = info.current_task.clone();
            self.refresh_row_labels(row, info);
        }
    }

    fn upsert_pane_inner(&self, info: &PaneInfo) {
        let card = Box::new(Orientation::Vertical, 4);
        card.add_css_class("session-card");

        // Top row: session-name + run-dot
        let name_row = Box::new(Orientation::Horizontal, 6);

        let name_label = Label::new(Some(&info.title));
        name_label.set_halign(Align::Start);
        name_label.set_hexpand(true);
        name_label.add_css_class("session-name");

        let run_dot = Label::new(Some("●"));
        run_dot.add_css_class("session-run-dot");
        run_dot.set_valign(Align::Center);

        name_row.append(&name_label);
        name_row.append(&run_dot);

        // Stats row: session-stats + delete
        let stats_row = Box::new(Orientation::Horizontal, 6);

        let stats_label = Label::new(None);
        stats_label.set_halign(Align::Start);
        stats_label.set_hexpand(true);
        stats_label.add_css_class("session-stats");

        let delete_btn = Button::with_label("Delete");
        delete_btn.add_css_class("session-delete");
        delete_btn.add_css_class("flat");
        let pane_id_btn = info.id.clone();
        let close_handler = Rc::clone(&self.close_handler);
        delete_btn.connect_clicked(move |_| {
            if let Some(cb) = close_handler.borrow().as_ref() {
                cb(pane_id_btn.clone());
            }
        });

        stats_row.append(&stats_label);
        stats_row.append(&delete_btn);

        card.append(&name_row);
        card.append(&stats_row);

        let list_row = ListBoxRow::new();
        list_row.set_child(Some(&card));
        list_row.set_widget_name(&info.id);
        list_row.add_css_class("session-row-new");
        self.list.append(&list_row);

        let mut live = SessionLive::default();
        live.agent_status = agent_status_label(&info.agent_status);
        live.session_tokens = info.session_tokens;
        live.current_task = info.current_task.clone();

        let mut session_row = SessionRow {
            row: list_row,
            card,
            name_label,
            run_dot,
            stats_label,
            delete_btn,
            live,
        };
        self.refresh_row_labels(&mut session_row, info);
        self.rows.borrow_mut().insert(info.id.clone(), session_row);
    }

    pub fn set_active_pane(&self, pane_id: Option<&str>) {
        *self.active_pane.borrow_mut() = pane_id.map(str::to_string);
        self.pane_manager.set_active_pane(pane_id);
        let rows = self.rows.borrow();
        for (id, row) in rows.iter() {
            let active = Some(id.as_str()) == pane_id;
            if active {
                row.card.add_css_class("selected");
            } else {
                row.card.remove_css_class("selected");
            }
        }
    }

    pub fn apply_session_update(&self, payload: &Value) {
        let Some(pane_id) = pane_id_from_payload(payload) else {
            return;
        };
        if let Some(info) = self.pane_manager.get(&pane_id) {
            self.upsert_pane(&info);
        } else if let Some(row) = self.rows.borrow_mut().get_mut(&pane_id) {
            if let Some(s) = payload.get("agentStatus").and_then(|v| v.as_str()) {
                row.live.agent_status = agent_status_label(s);
            }
            if let Some(t) = payload.get("currentTask").and_then(|v| v.as_str()) {
                row.live.current_task = Some(t.to_string());
            }
            if let Some(n) = payload.get("sessionTokens").and_then(|v| v.as_i64()) {
                row.live.session_tokens = n;
            }
            let title = row.name_label.text().to_string();
            let fake = PaneInfo {
                id: pane_id,
                title,
                cwd: String::new(),
                command: String::new(),
                event_socket: String::new(),
                status: payload
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("running")
                    .to_string(),
                pid: payload.get("pid").and_then(|v| v.as_u64()).map(|p| p as u32),
                rows: 24,
                cols: 80,
                retry_count: 0,
                swarm_role: None,
                gate_locked: false,
                agent_status: row.live.agent_status.to_string(),
                current_task: row.live.current_task.clone(),
                session_tokens: row.live.session_tokens,
                task_id: None,
            };
            self.refresh_row_labels(row, &fake);
        }
    }

    pub fn apply_ipc_payload(&self, payload: &Value) {
        let Some(pane_id) = pane_id_from_payload(payload) else {
            return;
        };
        let event_type = event_type_from_payload(payload);
        let inner = payload.get("payload").unwrap_or(payload);

        let mut rows = self.rows.borrow_mut();
        let Some(row) = rows.get_mut(&pane_id) else {
            drop(rows);
            if let Some(info) = self.pane_manager.get(&pane_id) {
                self.upsert_pane(&info);
            }
            return;
        };

        match event_type.as_str() {
            "session_start" => row.live.agent_status = "idle",
            "step_start" | "agent_turn" => row.live.agent_status = "working",
            "agent_complete" => row.live.agent_status = "complete",
            "session_end" => row.live.agent_status = "idle",
            "goal_status" => {
                if let Some(s) = inner.get("summary").and_then(|v| v.as_str()) {
                    row.live.current_task = Some(s.to_string());
                }
            }
            "cost_update" => {
                if let Some(n) = inner.get("sessionTokens").and_then(|v| v.as_i64()) {
                    row.live.session_tokens = n;
                }
            }
            _ => {}
        }

        let title = row.name_label.text().to_string();
        let info = self.pane_manager.get(&pane_id).unwrap_or(PaneInfo {
            id: pane_id.clone(),
            title,
            cwd: String::new(),
            command: String::new(),
            event_socket: String::new(),
            status: "running".to_string(),
            pid: None,
            rows: 24,
            cols: 80,
            retry_count: 0,
            swarm_role: None,
            gate_locked: false,
            agent_status: row.live.agent_status.to_string(),
            current_task: row.live.current_task.clone(),
            session_tokens: row.live.session_tokens,
            task_id: None,
        });
        self.refresh_row_labels(row, &info);
    }

    fn refresh_row_labels(&self, row: &mut SessionRow, info: &PaneInfo) {
        let is_running = row.live.agent_status == "working";
        row.run_dot.set_visible(is_running);

        row.stats_label.set_text(&format!(
            "{} · {} tok · {}",
            proc_label(info),
            format_token_count(row.live.session_tokens),
            row.live.agent_status
        ));

        // Keep status CSS classes on the stats label for potential use
        row.stats_label.remove_css_class("cursorsi-status-idle");
        row.stats_label.remove_css_class("cursorsi-status-working");
        row.stats_label.remove_css_class("cursorsi-status-complete");
        row.stats_label.remove_css_class("success");
        row.stats_label.remove_css_class("warning");
        match row.live.agent_status {
            "working" => {
                row.stats_label.add_css_class("cursorsi-status-working");
                row.stats_label.add_css_class("warning");
            }
            "complete" => {
                row.stats_label.add_css_class("cursorsi-status-complete");
                row.stats_label.add_css_class("success");
            }
            _ => row.stats_label.add_css_class("cursorsi-status-idle"),
        }
    }

    fn wire_selection(&self, in_rebuild: Rc<Cell<bool>>) {
        let column = Rc::clone(&self.column);
        self.list.connect_row_selected(move |_, selected| {
            if in_rebuild.get() {
                return;
            }
            let pane_id = selected.and_then(|row| {
                let name = row.widget_name();
                if name.is_empty() {
                    None
                } else {
                    Some(name.to_string())
                }
            });
            if let Some(ref id) = pane_id {
                column.borrow().focus_pane(id);
            }
        });
    }
}

fn agent_status_label(s: &str) -> &'static str {
    match s {
        "working" => "working",
        "complete" => "complete",
        _ => "idle",
    }
}

fn proc_label(info: &PaneInfo) -> String {
    if info.status == "exited" || info.status == "crashed" {
        info.status.clone()
    } else {
        format!("pid {}", info.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into()))
    }
}
