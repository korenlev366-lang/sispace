use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use gtk::prelude::*;
use gtk::{gdk, glib, Align, Box, Button, EventControllerScroll, Label, Orientation, ScrolledWindow, Widget};
use std::os::fd::{FromRawFd, OwnedFd};
use sispace_core::services::pane::{PaneInfo, PaneManager, PaneSpawnConfig};
use sispace_core::services::pane_ipc::PaneIpcContext;
use vte4::prelude::*;
use vte4::{Pty, Terminal};

use super::vte_paste::install_vte_paste_bindings;

const PANE_MIN_HEIGHT: i32 = 220;
/// BridgeSpace-style column count for tiled terminals.
const TILE_COLUMNS: usize = 3;

/// One embedded VTE terminal bound to a `PaneManager` session (cli/run.sh → cursorsi).
pub struct VtePaneWidget {
    pub pane_id: String,
    root: Box,
    terminal: Terminal,
}

impl VtePaneWidget {
    /// Attach to an already-spawned pane's duplicated master PTY fd.
    pub fn attach(
        pane_manager: &PaneManager,
        info: &PaneInfo,
        on_delete: Option<Rc<dyn Fn(String)>>,
        worktree_badge: Option<&str>,
    ) -> Result<Self, String> {
        let dup_fd = pane_manager.master_pty_fd(&info.id)?;
        let pty = Pty::foreign_sync(unsafe { OwnedFd::from_raw_fd(dup_fd) }, None::<&gtk::gio::Cancellable>)
            .map_err(|e| format!("vte foreign pty failed: {e}"))?;

        let terminal = Terminal::builder()
            .hexpand(true)
            .vexpand(true)
            .build();
        terminal.set_pty(Some(&pty));
        install_vte_paste_bindings(&terminal);

        terminal.set_scroll_on_keystroke(false);
        terminal.set_scroll_on_output(false);
        terminal.set_scroll_on_insert(false);
        terminal.set_scrollback_lines(100_000);

        let short_id = if info.id.len() > 6 { &info.id[info.id.len()-6..] } else { &info.id };
        let mut title_text = format!("{} · cursorsi · {}", info.title, short_id);
        if let Some(badge) = worktree_badge {
            title_text.push_str(&format!("  {badge}"));
        }
        let title = Label::new(Some(&title_text));
        title.set_tooltip_text(Some(&info.event_socket));
        title.set_halign(Align::Start);
        title.set_hexpand(true);
        title.add_css_class("pane-title");

        let close_btn = Button::with_label("×");
        close_btn.add_css_class("flat");
        close_btn.add_css_class("pane-close");
        close_btn.set_valign(Align::Center);
        if let Some(on_delete) = on_delete {
            let pane_id = info.id.clone();
            close_btn.connect_clicked(move |_| on_delete(pane_id.clone()));
        }

        let titlebar = Box::new(Orientation::Horizontal, 6);
        titlebar.add_css_class("pane-titlebar");
        titlebar.append(&title);
        titlebar.append(&close_btn);

        let status_text = format!(
            "pid {}",
            info.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into())
        );
        let status = Label::new(Some(&status_text));
        status.set_tooltip_text(Some(&info.command));
        status.set_halign(Align::Start);
        status.add_css_class("dim-label");
        status.add_css_class("pane-status");
        status.set_wrap(true);

        let pane_id = info.id.clone();
        let mgr = pane_manager.clone();
        let in_sync = Rc::new(Cell::new(false));
        let in_sync_realize = Rc::clone(&in_sync);
        let pane_id_realize = pane_id.clone();
        let mgr_realize = mgr.clone();
        terminal.connect_realize(move |term| {
            let Some(term) = term.downcast_ref::<Terminal>() else {
                return;
            };
            if !in_sync_realize.get() {
                in_sync_realize.set(true);
                sync_pty_size(term, &mgr_realize, &pane_id_realize);
                let in_sync_reset = Rc::clone(&in_sync_realize);
                glib::idle_add_local_once(move || {
                    in_sync_reset.set(false);
                });
            }
            let in_sync_chg = Rc::clone(&in_sync_realize);
            let pane_id_chg = pane_id_realize.clone();
            let mgr_chg = mgr_realize.clone();
            term.connect_char_size_changed(move |term, _w, _h| {
                if in_sync_chg.get() {
                    return;
                }
                in_sync_chg.set(true);
                sync_pty_size(term, &mgr_chg, &pane_id_chg);
                let in_sync_reset = Rc::clone(&in_sync_chg);
                glib::idle_add_local_once(move || {
                    in_sync_reset.set(false);
                });
            });
        });

        let term_scale = terminal.clone();
        let scroll_scale = EventControllerScroll::new(gtk::EventControllerScrollFlags::VERTICAL);
        terminal.add_controller(scroll_scale.clone());
        scroll_scale.connect_scroll(move |ctrl, _dx, dy| {
            let mods = ctrl.current_event_state();
            if mods.contains(gdk::ModifierType::CONTROL_MASK) {
                let cur = term_scale.font_scale();
                let delta = if dy < 0.0 { 0.1 } else { -0.1 };
                term_scale.set_font_scale((cur + delta).clamp(0.25, 4.0));
                glib::Propagation::Stop
            } else {
                glib::Propagation::Proceed
            }
        });

        let frame = Box::new(Orientation::Vertical, 0);
        frame.add_css_class("tiled-pane");
        frame.set_hexpand(true);
        frame.set_vexpand(false);
        frame.append(&titlebar);
        frame.append(&status);
        frame.append(&terminal);
        terminal.set_height_request(PANE_MIN_HEIGHT);

        Ok(Self {
            pane_id: info.id.clone(),
            root: frame,
            terminal,
        })
    }

    pub fn focus(&self) {
        self.terminal.grab_focus();
    }

    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }
}

fn sync_pty_size(terminal: &Terminal, pane_manager: &PaneManager, pane_id: &str) {
    let cols = terminal.column_count().max(1) as u16;
    let rows = terminal.row_count().max(1) as u16;
    if pane_manager
        .get(pane_id)
        .map(|info| info.rows == rows && info.cols == cols)
        .unwrap_or(false)
    {
        return;
    }
    let _ = pane_manager.resize(pane_id, rows, cols);
}

fn worktree_badge_label(abs_path: &str) -> String {
    if let Some(idx) = abs_path.find(".sispace-worktrees/") {
        format!("wt: {}", &abs_path[idx..])
    } else {
        format!("wt: {abs_path}")
    }
}

/// Tiled terminal workspace: panes distributed across columns (BridgeSpace-style density).
pub struct TerminalColumn {
    root: ScrolledWindow,
    column_boxes: Vec<Box>,
    pane_manager: Arc<PaneManager>,
    ipc_ctx: PaneIpcContext,
    panes: Rc<RefCell<Vec<VtePaneWidget>>>,
    session_count: Rc<RefCell<usize>>,
    close_handler: Rc<RefCell<Option<Rc<dyn Fn(String)>>>>,
}

impl TerminalColumn {
    pub fn new(pane_manager: Arc<PaneManager>, ipc_ctx: PaneIpcContext) -> Self {
        let columns_row = Box::new(Orientation::Horizontal, 8);
        columns_row.set_hexpand(true);
        columns_row.set_vexpand(false);
        columns_row.add_css_class("terminal-columns");

        let mut column_boxes = Vec::with_capacity(TILE_COLUMNS);
        for i in 0..TILE_COLUMNS {
            let col = Box::new(Orientation::Vertical, 8);
            col.set_hexpand(true);
            col.set_vexpand(false);
            col.set_homogeneous(false);
            col.add_css_class("terminal-column");
            col.set_widget_name(&format!("terminal-column-{i}"));
            columns_row.append(&col);
            column_boxes.push(col);
        }

        let scroll = ScrolledWindow::builder()
            .min_content_height(PANE_MIN_HEIGHT)
            .build();
        scroll.set_policy(gtk::PolicyType::Never, gtk::PolicyType::Automatic);
        scroll.set_propagate_natural_width(false);
        scroll.set_vexpand(true);
        scroll.set_hexpand(true);
        scroll.set_child(Some(&columns_row));

        Self {
            root: scroll,
            column_boxes,
            pane_manager,
            ipc_ctx,
            panes: Rc::new(RefCell::new(Vec::new())),
            session_count: Rc::new(RefCell::new(0)),
            close_handler: Rc::new(RefCell::new(None)),
        }
    }

    pub fn set_close_handler(&self, handler: Rc<dyn Fn(String)>) {
        *self.close_handler.borrow_mut() = Some(handler);
    }

    pub fn widget(&self) -> &ScrolledWindow {
        &self.root
    }

    pub fn pane_manager(&self) -> &Arc<PaneManager> {
        &self.pane_manager
    }

    pub fn spawn_terminal(&self, cwd: &str) -> Result<PaneInfo, String> {
        let n = {
            let mut c = self.session_count.borrow_mut();
            *c += 1;
            *c
        };
        let config = PaneSpawnConfig {
            title: format!("session-{n}"),
            cwd: Some(cwd.to_string()),
            command: None,
            task_id: None,
            skill_bundle: None,
            model_id: Some("composer-2.5".to_string()),
            subagent_model_id: None,
            rows: 24,
            cols: 80,
            swarm_role: None,
            gate_locked: None,
        };

        let info = self.pane_manager.spawn_for_vte(&self.ipc_ctx, config)?;
        let on_delete = self.make_delete_callback();
        let widget = VtePaneWidget::attach(&self.pane_manager, &info, Some(on_delete), None)?;
        self.register_tiled_pane(widget);
        Ok(info)
    }

    pub fn focus_pane(&self, pane_id: &str) {
        let _ = self.pane_manager.set_active_pane(Some(pane_id));
        for p in self.panes.borrow().iter() {
            let focused = p.pane_id == pane_id;
            if focused {
                p.root.add_css_class("focused");
                p.focus();
            } else {
                p.root.remove_css_class("focused");
            }
        }
    }

    pub fn spawn_and_focus(&self, cwd: &str) -> Result<PaneInfo, String> {
        let info = self.spawn_terminal(cwd)?;
        self.focus_pane(&info.id);
        Ok(info)
    }

    pub fn attach_pane_with_badge(
        &self,
        info: &PaneInfo,
        worktree_badge: Option<&str>,
        merge_conflict: bool,
    ) -> Result<(), String> {
        let on_delete = self.make_delete_callback();
        let badge = if merge_conflict {
            Some("⚠ merge conflict")
        } else {
            worktree_badge
        };
        let widget = VtePaneWidget::attach(&self.pane_manager, info, Some(on_delete), badge)?;
        self.register_tiled_pane(widget);
        Ok(())
    }

    pub fn attach_pane(&self, info: &PaneInfo) -> Result<(), String> {
        self.attach_pane_with_badge(info, None, false)
    }

    pub fn close_pane(&self, pane_id: &str) -> Result<(), String> {
        self.pane_manager.kill(&self.ipc_ctx, pane_id)?;
        self.remove_pane_ui(pane_id);
        Ok(())
    }

    pub fn remove_pane_ui(&self, pane_id: &str) {
        let mut panes = self.panes.borrow_mut();
        if let Some(idx) = panes.iter().position(|p| p.pane_id == pane_id) {
            let widget = panes.remove(idx);
            if let Some(parent) = widget.widget().parent() {
                if let Some(col) = parent.downcast_ref::<Box>() {
                    col.remove(widget.widget());
                }
            }
        }
    }

    fn make_delete_callback(&self) -> Rc<dyn Fn(String)> {
        let handler = Rc::clone(&self.close_handler);
        Rc::new(move |pane_id: String| {
            if let Some(cb) = handler.borrow().as_ref() {
                cb(pane_id);
            }
        })
    }

    pub fn attach_panes_and_focus_last(&self, infos: &[PaneInfo]) -> Result<(), String> {
        for info in infos {
            self.attach_pane(info)?;
        }
        if let Some(last) = infos.last() {
            self.focus_pane(&last.id);
        }
        Ok(())
    }

    pub fn attach_siswarm_panes(
        &self,
        bindings: &[sispace_core::services::swarm_workspace::SwarmPaneBinding],
        pane_manager: &PaneManager,
    ) -> Result<(), String> {
        for b in bindings {
            let Some(info) = pane_manager.get(&b.pane_id) else {
                continue;
            };
            let badge_label = b.worktree_path.as_deref().map(worktree_badge_label);
            self.attach_pane_with_badge(
                &info,
                badge_label.as_deref(),
                b.merge_conflict,
            )?;
        }
        if let Some(last) = bindings.last() {
            self.focus_pane(&last.pane_id);
        }
        Ok(())
    }

    pub fn clear_attached(&self) {
        for col in &self.column_boxes {
            let mut child = col.first_child();
            while let Some(c) = child {
                child = c.next_sibling();
                col.remove(&c);
            }
        }
        self.panes.borrow_mut().clear();
    }

    fn register_tiled_pane(&self, widget: VtePaneWidget) {
        let mut panes = self.panes.borrow_mut();
        let idx = panes.len() % TILE_COLUMNS;
        widget.widget().set_widget_name(&widget.pane_id);
        self.column_boxes[idx].append(widget.widget());
        panes.push(widget);
    }

}
