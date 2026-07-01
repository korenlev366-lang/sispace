use std::cell::RefCell;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use adw::Application;
use gtk::glib;
use gtk::prelude::*;
use gtk::{Box, Button, Label, Orientation, Paned, ScrolledWindow, TextView, Widget};
use serde_json::Value;
use sispace_core::services::pane_ipc::{pane_ipc_ctx, PaneIpcContext};
use sispace_core::services::swarm_workspace::{
    clear_session, get_state, launch_siswarm_for_vte, merge_siswarm_workers,
    read_blackboard_public, SiswarmWorkspaceState,
};
use sispace_core::services::node_host::project_root;
use sispace_core::state::AppState;

use crate::gtk_events::GtkPaneEventBridge;

use super::visualizer::SwarmVisualizer;
use crate::ui::sispace::TerminalColumn;

enum SwarmUiMsg {
    RefreshDone(Result<Option<SiswarmWorkspaceState>, String>),
    LaunchDone(Result<SiswarmWorkspaceState, String>),
    Blackboard(String),
    MergeDone(Result<Vec<sispace_core::services::swarm::WorkerMergeStatus>, String>),
}

#[allow(dead_code)]
struct SiswarmTabInner {
    column: Rc<RefCell<TerminalColumn>>,
    ipc_bridge: GtkPaneEventBridge,
    ipc_ctx: PaneIpcContext,
}

pub struct SiswarmTab {
    root: Box,
    visualizer: SwarmVisualizer,
    blackboard_view: TextView,
    error_label: Label,
    conflict_label: Label,
    inner: RefCell<Option<SiswarmTabInner>>,
    left_host: Box,
    term_host: Box,
    state: Rc<RefCell<Option<SiswarmWorkspaceState>>>,
    bg_tx: mpsc::Sender<SwarmUiMsg>,
    app_state: Arc<AppState>,
}

impl SiswarmTab {
    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }

    pub fn new(_app: &Application, app_state: Arc<AppState>) -> Rc<Self> {
        let (bg_tx, bg_rx) = mpsc::channel();

        let root = Box::new(Orientation::Vertical, 0);
        root.set_vexpand(true);
        root.set_hexpand(true);

        let header = Box::new(Orientation::Vertical, 4);
        header.set_margin_top(12);
        header.set_margin_start(12);
        header.set_margin_end(12);
        let title = Label::new(Some("SISwarm"));
        title.add_css_class("title-2");
        let sub = Label::new(Some(
            "Parallel swarm topology — coordinator, workers, gated verifier & synthesizer.",
        ));
        sub.set_wrap(true);
        sub.add_css_class("dim-label");
        header.append(&title);
        header.append(&sub);
        root.append(&header);

        let toolbar = Box::new(Orientation::Horizontal, 6);
        toolbar.set_margin_start(12);
        toolbar.set_margin_end(12);
        let launch_btn = Button::with_label("Launch SISwarm");
        launch_btn.add_css_class("cursorsi-action");
        let refresh_btn = Button::with_label("Refresh");
        let board_btn = Button::with_label("Refresh blackboard");
        let clear_btn = Button::with_label("Clear");
        let merge_btn = Button::with_label("Merge workers");
        let conflict_label = Label::new(None);
        conflict_label.add_css_class("warning");
        conflict_label.set_wrap(true);
        conflict_label.set_visible(false);
        for b in [&launch_btn, &refresh_btn, &board_btn, &merge_btn, &clear_btn] {
            toolbar.append(b);
        }
        toolbar.append(&conflict_label);
        root.append(&toolbar);

        let error_label = Label::new(None);
        error_label.add_css_class("error");
        error_label.set_wrap(true);
        error_label.set_margin_start(12);
        error_label.set_margin_end(12);
        error_label.set_visible(false);
        root.append(&error_label);

        let paned = Paned::new(Orientation::Horizontal);
        paned.set_vexpand(true);
        paned.set_hexpand(true);
        paned.set_shrink_start_child(true);
        paned.set_shrink_end_child(true);
        paned.set_position(420);

        let left_host = Box::new(Orientation::Vertical, 8);
        left_host.set_margin_top(8);
        left_host.set_margin_start(8);
        left_host.set_margin_end(8);
        left_host.set_margin_bottom(8);
        left_host.set_width_request(380);
        left_host.set_vexpand(true);

        let term_host = Box::new(Orientation::Vertical, 0);
        term_host.set_vexpand(true);
        term_host.set_hexpand(true);
        paned.set_start_child(Some(&left_host));
        paned.set_end_child(Some(&term_host));

        root.append(&paned);

        let swarm_state = Rc::new(RefCell::new(None));
        let tab = Rc::new(Self {
            root,
            visualizer: SwarmVisualizer::new(),
            blackboard_view: TextView::new(),
            error_label: error_label.clone(),
            conflict_label: conflict_label.clone(),
            inner: RefCell::new(None),
            left_host,
            term_host: term_host.clone(),
            state: Rc::clone(&swarm_state),
            bg_tx: bg_tx.clone(),
            app_state,
        });

        let poll = Rc::clone(&tab);
        glib::timeout_add_local(Duration::from_millis(32), move || {
            while let Ok(msg) = bg_rx.try_recv() {
                poll.handle_bg(msg);
            }
            glib::ControlFlow::Continue
        });

        let poll_refresh = Rc::clone(&tab);
        glib::timeout_add_local(Duration::from_secs(2), move || {
            if poll_refresh.state.borrow().is_some() {
                poll_refresh.refresh_state_async();
            }
            glib::ControlFlow::Continue
        });

        tab.wire_events(launch_btn, refresh_btn, board_btn, merge_btn, clear_btn);

        tab
    }

    pub fn finish_mount(self: &Rc<Self>) {
        if self.inner.borrow().is_some() {
            return;
        }
        let tab = Rc::clone(self);
        glib::idle_add_local_once(move || {
            tab.finish_layout();
        });
    }

    fn finish_layout(self: &Rc<Self>) {
        if self.inner.borrow().is_some() {
            return;
        }

        let left = &self.left_host;
        left.append(self.visualizer.widget());

        let board_title = Label::new(Some("Obsidian blackboard"));
        board_title.add_css_class("heading");
        left.append(&board_title);

        self.blackboard_view.set_editable(false);
        self.blackboard_view.set_monospace(true);
        self.blackboard_view.set_vexpand(true);
        let board_scroll = ScrolledWindow::builder()
            .min_content_height(160)
            .vexpand(true)
            .build();
        board_scroll.set_child(Some(&self.blackboard_view));
        left.append(&board_scroll);

        let ipc_bridge = GtkPaneEventBridge::new();
        let ipc_ctx = pane_ipc_ctx(self.app_state.as_ref(), ipc_bridge.dispatcher());
        let column = Rc::new(RefCell::new(TerminalColumn::new(
            Arc::clone(&self.app_state.pane_manager),
            ipc_ctx.clone(),
        )));

        ipc_bridge.attach_siswarm(Rc::clone(self));

        *self.inner.borrow_mut() = Some(SiswarmTabInner {
            column,
            ipc_bridge,
            ipc_ctx,
        });
    }

    fn wire_events(
        self: &Rc<Self>,
        launch: Button,
        refresh: Button,
        board: Button,
        merge: Button,
        clear: Button,
    ) {
        let p = Rc::clone(self);
        launch.connect_clicked(move |_| {
            p.error_label.set_visible(false);
            if let Some(inner) = p.inner.borrow().as_ref() {
                inner.column.borrow().clear_attached();
            }
            p.launch_async(p.bg_tx.clone());
        });

        let p = Rc::clone(self);
        refresh.connect_clicked(move |_| {
            p.error_label.set_visible(false);
            p.refresh_state_async_to(p.bg_tx.clone());
        });

        let p = Rc::clone(self);
        board.connect_clicked(move |_| {
            p.error_label.set_visible(false);
            p.refresh_blackboard_async(p.bg_tx.clone());
        });

        let p = Rc::clone(self);
        merge.connect_clicked(move |_| {
            p.error_label.set_visible(false);
            p.merge_async(p.bg_tx.clone());
        });

        let p = Rc::clone(self);
        clear.connect_clicked(move |_| {
            clear_session(&p.app_state);
            if let Some(inner) = p.inner.borrow().as_ref() {
                inner.column.borrow().clear_attached();
            }
            *p.state.borrow_mut() = None;
            p.visualizer.set_state(None);
            p.blackboard_view.buffer().set_text("");
            p.error_label.set_visible(false);
            p.conflict_label.set_visible(false);
        });

        let p = Rc::clone(self);
        self.visualizer.set_on_select(move |pane_id| {
            if let Some(inner) = p.inner.borrow().as_ref() {
                inner.column.borrow().focus_pane(pane_id);
            }
            p.visualizer.set_focused_pane(Some(pane_id));
        });
    }

    pub fn on_ipc_dispatch(&self, _channel: &str, _payload: &Value) {
        // SISwarm tab might handle specific IPC events here if needed.
        // Currently driven by refresh_state_async polling or manual refresh.
    }

    fn handle_bg(&self, msg: SwarmUiMsg) {
        match msg {
            SwarmUiMsg::RefreshDone(result) => match result {
                Ok(opt) => {
                    self.apply_state(opt, false);
                    self.error_label.set_visible(false);
                }
                Err(e) => {
                    self.error_label.set_text(&e);
                    self.error_label.set_visible(true);
                }
            },
            SwarmUiMsg::LaunchDone(result) => match result {
                Ok(launched) => {
                    self.apply_state(Some(launched), true);
                    self.error_label.set_visible(false);
                }
                Err(e) => {
                    self.error_label.set_text(&e);
                    self.error_label.set_visible(true);
                }
            },
            SwarmUiMsg::Blackboard(text) => {
                self.blackboard_view.buffer().set_text(&text);
            }
            SwarmUiMsg::MergeDone(result) => match result {
                Ok(statuses) => {
                    let merged = statuses.iter().filter(|s| s.merged).count();
                    let conflicts = statuses.iter().filter(|s| s.has_conflicts).count();
                    self.error_label.set_text(&format!(
                        "Merge complete: {merged} merged, {conflicts} with conflicts"
                    ));
                    self.error_label.set_visible(true);
                    self.refresh_state_async();
                }
                Err(e) => {
                    self.error_label.set_text(&e);
                    self.error_label.set_visible(true);
                }
            },
        }
    }

    fn update_conflict_banner(&self, st: &SiswarmWorkspaceState) {
        if st.merge_conflicts.is_empty() {
            self.conflict_label.set_visible(false);
        } else {
            self.conflict_label.set_text(&format!(
                "⚠ merge conflicts: {}",
                st.merge_conflicts.join(", ")
            ));
            self.conflict_label.set_visible(true);
        }
    }

    fn apply_state(&self, opt: Option<SiswarmWorkspaceState>, attach_vte: bool) {
        if attach_vte {
            if let Some(ref st) = opt {
                while let Some(child) = self.term_host.first_child() {
                    self.term_host.remove(&child);
                }
                if let Some(inner) = self.inner.borrow().as_ref() {
                    let col = inner.column.borrow();
                    self.term_host.append(col.widget());
                    let _ = col.attach_siswarm_panes(
                        &st.bindings,
                        self.app_state.pane_manager.as_ref(),
                    );
                }
                self.blackboard_view.buffer().set_text(&st.blackboard);
                self.update_conflict_banner(st);
            }
        }
        if let Some(ref st) = opt {
            self.visualizer.set_state(Some(st.clone()));
        } else {
            self.visualizer.set_state(None);
        }
        *self.state.borrow_mut() = opt;
    }

    fn refresh_state_async(&self) {
        self.refresh_state_async_to(self.bg_tx.clone());
    }

    fn refresh_state_async_to(&self, tx: mpsc::Sender<SwarmUiMsg>) {
        let app_state = Arc::clone(&self.app_state);
        std::thread::spawn(move || {
            let res = get_state(&app_state);
            let _ = tx.send(SwarmUiMsg::RefreshDone(res));
        });
    }

    fn refresh_blackboard_async(&self, tx: mpsc::Sender<SwarmUiMsg>) {
        let st_opt = self.state.borrow().clone();
        let proj = project_root().to_string_lossy().into_owned();
        std::thread::spawn(move || {
            let note = st_opt.map(|s| s.obsidian_note_path).unwrap_or_default();
            let text = read_blackboard_public(&note, &proj);
            let _ = tx.send(SwarmUiMsg::Blackboard(text));
        });
    }

    fn launch_async(&self, tx: mpsc::Sender<SwarmUiMsg>) {
        let app_state = Arc::clone(&self.app_state);
        let inner_opt = self
            .inner
            .borrow()
            .as_ref()
            .map(|i| i.ipc_ctx.clone());
        std::thread::spawn(move || {
            let Some(ctx) = inner_opt else {
                let _ = tx.send(SwarmUiMsg::LaunchDone(Err("IPC context not ready".to_string())));
                return;
            };
            let res = launch_siswarm_for_vte(&ctx, &app_state, None, None, None);
            let _ = tx.send(SwarmUiMsg::LaunchDone(res));
        });
    }

    fn merge_async(&self, tx: mpsc::Sender<SwarmUiMsg>) {
        let app_state = Arc::clone(&self.app_state);
        let root_id = self
            .state
            .borrow()
            .as_ref()
            .map(|s| s.root_id.clone());
        std::thread::spawn(move || {
            let Some(rid) = root_id else {
                let _ = tx.send(SwarmUiMsg::MergeDone(Err("No active SISwarm session".to_string())));
                return;
            };
            let res = merge_siswarm_workers(&app_state, &rid);
            let _ = tx.send(SwarmUiMsg::MergeDone(res));
        });
    }
}

pub fn build_siswarm_tab(app: &Application, state: Arc<AppState>) -> Rc<SiswarmTab> {
    SiswarmTab::new(app, state)
}
