use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gtk::glib;
use serde_json::Value;

use super::meta_panel::MetaPanel;
use super::pane_events::{is_meta_feed_channel, pane_id_from_payload};
use super::session_sidebar::SessionSidebar;
use super::terminal_column::TerminalColumn;

/// Coordinates sidebar, meta feed, and terminal column IPC updates.
pub struct SispacePaneUi {
    pub sidebar: SessionSidebar,
    pub meta: MetaPanel,
    pub column: Rc<RefCell<TerminalColumn>>,
    on_pane_list_changed: RefCell<Option<Rc<dyn Fn()>>>,
    sync_guard: Rc<Cell<bool>>,
}

impl SispacePaneUi {
    pub fn new(
        sidebar: SessionSidebar,
        meta: MetaPanel,
        column: Rc<RefCell<TerminalColumn>>,
    ) -> Self {
        Self {
            sidebar,
            meta,
            column,
            on_pane_list_changed: RefCell::new(None),
            sync_guard: Rc::new(Cell::new(false)),
        }
    }

    pub fn set_on_pane_list_changed(&self, handler: Rc<dyn Fn()>) {
        *self.on_pane_list_changed.borrow_mut() = Some(handler);
    }

    fn notify_pane_list_changed(&self) {
        if let Some(cb) = self.on_pane_list_changed.borrow().as_ref() {
            cb();
        }
    }

    pub fn wire_close_handlers(self: &Rc<Self>) {
        let ui_col = Rc::clone(self);
        self.column.borrow().set_close_handler(Rc::new(move |pane_id| {
            let _ = ui_col.close_pane(&pane_id);
        }));
        let ui_side = Rc::clone(self);
        self.sidebar.set_close_handler(Rc::new(move |pane_id| {
            let _ = ui_side.close_pane(&pane_id);
        }));
    }

    pub fn handle_dispatch(&self, channel: &str, payload: &Value) {
        if is_meta_feed_channel(channel) {
            self.meta.append_feed(channel, payload);
            self.sidebar.apply_ipc_payload(payload);
        }

        if channel == "pane:session-update" {
            self.sidebar.apply_session_update(payload);
        } else if channel == "pane-exit" || channel == "pane:exited" {
            if let Some(pane_id) = pane_id_from_payload(payload) {
                self.on_pane_exited(&pane_id);
            }
        } else if channel == "pane:spawned" {
            if let Some(pane_id) = pane_id_from_payload(payload) {
                self.on_pane_spawned(&pane_id);
            }
        } else if channel == "pane:focus" {
            if let Some(pane_id) = pane_id_from_payload(payload) {
                self.focus_pane(&pane_id);
            }
        }
    }

    /// Kill pane process, drop manager entry, and remove VTE + sidebar UI.
    pub fn close_pane(&self, pane_id: &str) -> Result<(), String> {
        let col = self.column.borrow();
        if col.pane_manager().get(pane_id).is_some() {
            col.close_pane(pane_id)?;
        } else {
            col.remove_pane_ui(pane_id);
        }
        self.sidebar.remove_pane(pane_id);
        self.refresh_after_pane_removed(pane_id);
        self.notify_pane_list_changed();
        Ok(())
    }

    fn on_pane_exited(&self, pane_id: &str) {
        if self.sync_guard.get() {
            return;
        }
        self.sync_guard.set(true);
        self.column.borrow().remove_pane_ui(pane_id);
        self.sidebar.remove_pane(pane_id);
        self.refresh_after_pane_removed(pane_id);
        self.notify_pane_list_changed();
        let guard = self.sync_guard.clone();
        glib::idle_add_local_once(move || {
            guard.set(false);
        });
    }

    fn refresh_after_pane_removed(&self, closed_id: &str) {
        let col = self.column.borrow();
        let panes = col.pane_manager().list();
        let next = panes
            .iter()
            .find(|p| p.id != closed_id)
            .or(panes.first());
        self.meta
            .refresh_pane_dropdown(next.map(|p| p.id.as_str()));
        self.sidebar
            .set_active_pane(next.map(|p| p.id.as_str()));
        if let Some(p) = next {
            col.focus_pane(&p.id);
        }
    }

    pub fn on_pane_spawned(&self, pane_id: &str) {
        if self.sync_guard.get() {
            return;
        }
        self.sync_guard.set(true);
        let col = self.column.borrow();
        if let Some(info) = col.pane_manager().get(pane_id) {
            self.sidebar.upsert_pane(&info);
        }
        // Do NOT call sync_from_manager() here — upsert_pane already created the
        // sidebar row for this specific pane. sync_from_manager iterates ALL
        // panes and would re-add every pane that does not yet have a row, which
        // is redundant and could race with IPC-delayed events.
        self.meta.refresh_pane_dropdown(Some(pane_id));
        self.sidebar.set_active_pane(Some(pane_id));
        self.notify_pane_list_changed();
        let guard = self.sync_guard.clone();
        glib::idle_add_local_once(move || {
            guard.set(false);
        });
    }

    pub fn focus_pane(&self, pane_id: &str) {
        if self.sync_guard.get() {
            return;
        }
        self.sync_guard.set(true);
        self.column.borrow().focus_pane(pane_id);
        self.sidebar.set_active_pane(Some(pane_id));
        self.meta.refresh_pane_dropdown(Some(pane_id));
        let guard = self.sync_guard.clone();
        glib::idle_add_local_once(move || {
            guard.set(false);
        });
    }
}
