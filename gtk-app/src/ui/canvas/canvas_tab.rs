use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use adw::prelude::*;
use adw::EntryRow;
use gtk::gdk;
use gtk::glib;
use gtk::prelude::{BoxExt, ButtonExt, TextBufferExt, WidgetExt};
use gtk::{
    Box, Button, Label, ListBox, ListBoxRow, Orientation, Paned, ScrolledWindow, Stack, TextView,
    Widget,
};
use sispace_core::services::canvas::{
    build_agent_prompt, detect_remote_debugging_port, format_element_view, list_browser_tabs,
    pick_element, BROWSER_LAUNCH_HINT, CdpTarget, PickedElement,
};
use sispace_core::services::node_host::project_root;
use sispace_core::services::pane::{PaneManager, PaneSpawnConfig};
use sispace_core::services::pane_ipc::PaneIpcContext;
use sispace_core::state::AppState;

enum CanvasUiMsg {
    DetectDone(Option<u16>),
    TabsDone(Result<Vec<CdpTarget>, String>),
    PickDone(Result<PickedElement, String>),
}

use crate::gtk_events::GtkPaneEventBridge;

#[allow(dead_code)]
struct CanvasTabInner {
    setup_panel: Box,
    main_panel: Box,
}

/// SICanvas tab — external browser attach via Chrome DevTools Protocol.
pub struct CanvasTab {
    root: Box,
    stack: Stack,
    tab_list: ListBox,
    selector_label: Label,
    html_view: TextView,
    prompt_entry: EntryRow,
    error_label: Label,
    pick_btn: Button,
    cdp_port: RefCell<Option<u16>>,
    selected_target: RefCell<Option<CdpTarget>>,
    picked_element: RefCell<Option<PickedElement>>,
    browser_tabs: RefCell<Vec<CdpTarget>>,
    pane_manager: Arc<PaneManager>,
    ipc_ctx: PaneIpcContext,
    bg_tx: mpsc::Sender<CanvasUiMsg>,
    _ipc_bridge: GtkPaneEventBridge,
    suppress_tab_select: Rc<Cell<bool>>,
    inner: RefCell<Option<CanvasTabInner>>,
}

impl CanvasTab {
    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }

    pub fn new(
        _app: &adw::Application,
        app_state: Arc<AppState>,
        ipc_ctx: PaneIpcContext,
        ipc_bridge: GtkPaneEventBridge,
    ) -> Rc<Self> {
        let (bg_tx, bg_rx) = mpsc::channel();

        let root = Box::new(Orientation::Vertical, 0);
        root.set_vexpand(true);
        root.set_hexpand(true);

        let header = Box::new(Orientation::Vertical, 4);
        header.set_margin_top(12);
        header.set_margin_start(12);
        header.set_margin_end(12);
        let title = Label::new(Some("SICanvas"));
        title.add_css_class("title-2");
        let sub = Label::new(Some(
            "External browser attach — pick DOM elements and send context to cursorsi panes.",
        ));
        sub.set_wrap(true);
        sub.add_css_class("dim-label");
        header.append(&title);
        header.append(&sub);
        root.append(&header);

        let error_label = Label::new(None);
        error_label.add_css_class("error");
        error_label.set_wrap(true);
        error_label.set_margin_start(12);
        error_label.set_margin_end(12);
        error_label.set_visible(false);
        root.append(&error_label);

        let stack = Stack::new();
        stack.set_vexpand(true);
        stack.set_hexpand(true);
        stack.set_margin_start(12);
        stack.set_margin_end(12);
        stack.set_margin_bottom(12);

        root.append(&stack);

        let tab = Rc::new(Self {
            root,
            stack,
            tab_list: ListBox::new(),
            selector_label: Label::new(None),
            html_view: TextView::new(),
            prompt_entry: EntryRow::new(),
            error_label,
            pick_btn: Button::with_label("Pick element"),
            cdp_port: RefCell::new(None),
            selected_target: RefCell::new(None),
            picked_element: RefCell::new(None),
            browser_tabs: RefCell::new(Vec::new()),
            pane_manager: Arc::clone(&app_state.pane_manager),
            ipc_ctx,
            bg_tx: bg_tx.clone(),
            _ipc_bridge: ipc_bridge,
            suppress_tab_select: Rc::new(Cell::new(false)),
            inner: RefCell::new(None),
        });

        tab.wire_bg_channel(bg_rx);

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

        let setup_panel = Self::build_setup_panel(&self.bg_tx);
        self.stack.add_named(&setup_panel, Some("setup"));

        let main_panel = Box::new(Orientation::Vertical, 8);
        main_panel.set_vexpand(true);
        main_panel.set_hexpand(true);

        let toolbar = Box::new(Orientation::Horizontal, 6);
        let refresh_btn = Button::with_label("Refresh");
        self.pick_btn.add_css_class("suggested-action");
        toolbar.append(&refresh_btn);
        toolbar.append(&self.pick_btn);
        main_panel.append(&toolbar);

        let paned = Paned::new(Orientation::Horizontal);
        paned.set_vexpand(true);
        paned.set_hexpand(true);
        paned.set_position(320);

        let left = Box::new(Orientation::Vertical, 6);
        let tabs_title = Label::new(Some("Browser tabs"));
        tabs_title.add_css_class("heading");
        left.append(&tabs_title);

        let tab_scroll = ScrolledWindow::builder()
            .min_content_width(260)
            .vexpand(true)
            .hexpand(true)
            .build();
        self.tab_list.set_selection_mode(gtk::SelectionMode::None);
        self.tab_list.add_css_class("navigation-sidebar");
        tab_scroll.set_child(Some(&self.tab_list));
        left.append(&tab_scroll);

        let right = Box::new(Orientation::Vertical, 8);
        right.set_vexpand(true);
        right.set_hexpand(true);

        self.selector_label.set_text("Element path: (none)");
        self.selector_label.set_halign(gtk::Align::Start);
        self.selector_label.set_wrap(true);
        self.selector_label.add_css_class("monospace");
        right.append(&self.selector_label);

        let html_scroll = ScrolledWindow::builder()
            .vexpand(true)
            .hexpand(true)
            .min_content_height(200)
            .build();
        self.html_view.set_editable(false);
        self.html_view.set_monospace(true);
        self.html_view.add_css_class("monospace");
        self.html_view.set_wrap_mode(gtk::WrapMode::WordChar);
        html_scroll.set_child(Some(&self.html_view));
        right.append(&html_scroll);

        self.prompt_entry.set_title("Agent prompt");
        self.prompt_entry.set_show_apply_button(false);
        right.append(&self.prompt_entry);

        let dispatch_row = Box::new(Orientation::Horizontal, 8);
        let send_active_btn = Button::with_label("Send to active pane");
        send_active_btn.add_css_class("suggested-action");
        let send_new_btn = Button::with_label("Send to new pane");
        dispatch_row.append(&send_active_btn);
        dispatch_row.append(&send_new_btn);
        right.append(&dispatch_row);

        paned.set_start_child(Some(&left));
        paned.set_end_child(Some(&right));
        main_panel.append(&paned);
        self.stack.add_named(&main_panel, Some("main"));

        *self.inner.borrow_mut() = Some(CanvasTabInner {
            setup_panel,
            main_panel,
        });

        self.wire_pick();
        self.wire_tab_selection();
        self.wire_dispatch(send_active_btn, send_new_btn);

        refresh_btn.connect_clicked({
            let tab = Rc::clone(self);
            move |_| tab.run_detect()
        });

        let tab_enable = Rc::clone(self);
        glib::idle_add_local_once(move || {
            tab_enable
                .tab_list
                .set_selection_mode(gtk::SelectionMode::Single);
            tab_enable.run_detect();
        });
    }

    fn build_setup_panel(bg_tx: &mpsc::Sender<CanvasUiMsg>) -> Box {
        let panel = Box::new(Orientation::Vertical, 12);
        panel.set_valign(gtk::Align::Center);
        panel.set_halign(gtk::Align::Center);
        panel.set_margin_top(48);
        panel.set_margin_bottom(48);

        let icon = Label::new(Some("No browser with remote debugging detected"));
        icon.add_css_class("title-3");
        panel.append(&icon);

        let hint = Label::new(Some(
            "Start your browser with remote debugging enabled, then click Refresh.",
        ));
        hint.set_wrap(true);
        hint.set_justify(gtk::Justification::Center);
        hint.add_css_class("dim-label");
        panel.append(&hint);

        let cmd_box = Box::new(Orientation::Horizontal, 8);
        cmd_box.set_halign(gtk::Align::Center);
        let cmd_label = Label::new(Some(BROWSER_LAUNCH_HINT));
        cmd_label.add_css_class("monospace");
        cmd_label.set_selectable(true);
        let copy_btn = Button::with_label("Copy");
        copy_btn.connect_clicked(move |_| {
            if let Some(display) = gdk::Display::default() {
                display.clipboard().set_text(BROWSER_LAUNCH_HINT);
            } // else: no display (headless) — silently ignore
        });
        cmd_box.append(&cmd_label);
        cmd_box.append(&copy_btn);
        panel.append(&cmd_box);

        let alt = Label::new(Some(
            "Firefox: firefox --remote-debugging-port=9222\n\
             Detected via: ps aux | grep -- \"--remote-debugging-port\"",
        ));
        alt.set_justify(gtk::Justification::Center);
        alt.add_css_class("caption");
        alt.set_wrap(true);
        panel.append(&alt);

        let refresh_btn = Button::with_label("Refresh");
        refresh_btn.set_halign(gtk::Align::Center);
        refresh_btn.add_css_class("suggested-action");
        let tx = bg_tx.clone();
        refresh_btn.connect_clicked(move |_| {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let port = detect_remote_debugging_port();
                let _ = tx.send(CanvasUiMsg::DetectDone(port));
            });
        });
        panel.append(&refresh_btn);

        panel
    }

    fn run_detect(self: &Rc<Self>) {
        self.error_label.set_visible(false);
        let tx = self.bg_tx.clone();
        std::thread::spawn(move || {
            let port = detect_remote_debugging_port();
            let _ = tx.send(CanvasUiMsg::DetectDone(port));
        });
    }

    fn run_list_tabs(self: &Rc<Self>, port: u16) {
        let tx = self.bg_tx.clone();
        std::thread::spawn(move || {
            let result = list_browser_tabs(port);
            let _ = tx.send(CanvasUiMsg::TabsDone(result));
        });
    }

    fn wire_pick(self: &Rc<Self>) {
        let tab = Rc::clone(self);
        self.pick_btn.connect_clicked(move |_| {
            tab.error_label.set_visible(false);
            let target = tab.selected_target.borrow().clone();

            let Some(target) = target else {
                tab.error_label.set_text("Select a browser tab to attach first.");
                tab.error_label.set_visible(true);
                return;
            };
            let ws = target
                .web_socket_debugger_url
                .clone()
                .unwrap_or_default();
            if ws.is_empty() {
                tab.error_label.set_text("Selected tab has no CDP WebSocket URL.");
                tab.error_label.set_visible(true);
                return;
            }
            tab.pick_btn.set_sensitive(false);
            tab.selector_label
                .set_text("Element path: (click an element in the browser…)");
            let tx = tab.bg_tx.clone();
            std::thread::spawn(move || {
                let result = pick_element(&ws, Duration::from_secs(120));
                let _ = tx.send(CanvasUiMsg::PickDone(result));
            });
        });
    }

    fn wire_tab_selection(self: &Rc<Self>) {
        let tab = Rc::clone(self);
        let in_rebuild = Rc::new(Cell::new(false));
        self.tab_list.connect_row_selected(move |list, _| {
            if in_rebuild.get() { return; }
            in_rebuild.set(true);
            if tab.suppress_tab_select.get() {
                let in_rebuild_reset = Rc::clone(&in_rebuild);
                glib::idle_add_local_once(move || {
                    in_rebuild_reset.set(false);
                });
                return;
            }
            let Some(selected) = list.selected_row() else {
                *tab.selected_target.borrow_mut() = None;
                let in_rebuild_reset = Rc::clone(&in_rebuild);
                glib::idle_add_local_once(move || {
                    in_rebuild_reset.set(false);
                });
                return;
            };
            let mut idx = 0usize;
            let mut i = 0i32;
            while let Some(r) = list.row_at_index(i) {
                if r == selected {
                    idx = i as usize;
                    break;
                }
                i += 1;
            }
            if let Some(target) = tab.browser_tabs.borrow().get(idx).cloned() {
                *tab.selected_target.borrow_mut() = Some(target);
            }
            let in_rebuild_reset = Rc::clone(&in_rebuild);
            glib::idle_add_local_once(move || {
                in_rebuild_reset.set(false);
            });
        });
    }

    fn wire_dispatch(self: &Rc<Self>, send_active: Button, send_new: Button) {
        let tab_active = Rc::clone(self);
        send_active.connect_clicked(move |_| {
            tab_active.dispatch_to_active();
        });
        let tab_new = Rc::clone(self);
        send_new.connect_clicked(move |_| {
            tab_new.dispatch_to_new();
        });
    }

    fn dispatch_to_active(self: &Rc<Self>) {
        self.error_label.set_visible(false);
        let Some(pick) = self.picked_element.borrow().clone() else {
            self.error_label
                .set_text("Pick an element before sending to a pane.");
            self.error_label.set_visible(true);
            return;
        };
        let prompt = self.prompt_entry.text().to_string();
        if prompt.trim().is_empty() {
            self.error_label.set_text("Enter a prompt in the bar below.");
            self.error_label.set_visible(true);
            return;
        }
        let Some(pane_id) = self.pane_manager.resolve_active_pane_id() else {
            self.error_label
                .set_text("No active cursorsi pane — spawn one in SISpace first.");
            self.error_label.set_visible(true);
            return;
        };
        let payload = build_agent_prompt(&prompt, &pick);
        match self.pane_manager.inject_prompt(&pane_id, &payload) {
            Ok(()) => self.prompt_entry.set_text(""),
            Err(e) => {
                self.error_label.set_text(&e);
                self.error_label.set_visible(true);
            }
        }
    }

    fn dispatch_to_new(self: &Rc<Self>) {
        self.error_label.set_visible(false);
        let Some(pick) = self.picked_element.borrow().clone() else {
            self.error_label
                .set_text("Pick an element before sending to a pane.");
            self.error_label.set_visible(true);
            return;
        };
        let prompt = self.prompt_entry.text().to_string();
        if prompt.trim().is_empty() {
            self.error_label.set_text("Enter a prompt in the bar below.");
            self.error_label.set_visible(true);
            return;
        }
        let cwd = project_root().to_string_lossy().into_owned();
        let config = PaneSpawnConfig {
            title: "SICanvas".to_string(),
            cwd: Some(cwd),
            command: None,
            task_id: None,
            skill_bundle: None,
            // Centralized default in models/task.rs — avoid hardcoded model strings.
            model_id: Some(sispace_core::models::task::DEFAULT_MODEL_ID.to_string()),
            subagent_model_id: None,
            rows: 24,
            cols: 80,
            swarm_role: None,
            gate_locked: None,
        };
        let payload = build_agent_prompt(&prompt, &pick);
        match self
            .pane_manager
            .spawn_for_vte(&self.ipc_ctx, config)
        {
            Ok(info) => {
                self.pane_manager.set_active_pane(Some(&info.id));
                match self.pane_manager.inject_prompt(&info.id, &payload) {
                    Ok(()) => self.prompt_entry.set_text(""),
                    Err(e) => {
                        self.error_label.set_text(&e);
                        self.error_label.set_visible(true);
                    }
                }
            }
            Err(e) => {
                self.error_label.set_text(&e);
                self.error_label.set_visible(true);
            }
        }
    }

    fn wire_bg_channel(self: &Rc<Self>, bg_rx: mpsc::Receiver<CanvasUiMsg>) {
        let tab = Rc::clone(self);
        glib::timeout_add_local(Duration::from_millis(100), move || {
            while let Ok(msg) = bg_rx.try_recv() {
                tab.handle_bg_msg(msg);
            }
            glib::ControlFlow::Continue
        });
    }

    fn handle_bg_msg(self: &Rc<Self>, msg: CanvasUiMsg) {
        match msg {
            CanvasUiMsg::DetectDone(port) => {
                if let Some(port) = port {
                    *self.cdp_port.borrow_mut() = Some(port);
                    self.stack.set_visible_child_name("main");
                    self.run_list_tabs(port);
                } else {
                    *self.cdp_port.borrow_mut() = None;
                    self.stack.set_visible_child_name("setup");
                    self.clear_tab_list();
                }
            }
            CanvasUiMsg::TabsDone(result) => match result {
                Ok(targets) => self.populate_tabs(targets),
                Err(e) => {
                    self.error_label.set_text(&e);
                    self.error_label.set_visible(true);
                }
            },
            CanvasUiMsg::PickDone(result) => {
                self.pick_btn.set_sensitive(true);
                match result {
                    Ok(pick) => self.show_pick(pick),
                    Err(e) => {
                        self.error_label.set_text(&e);
                        self.error_label.set_visible(true);
                    }
                }
            }
        }
    }

    fn clear_tab_list(&self) {
        while let Some(row) = self.tab_list.row_at_index(0) {
            self.tab_list.remove(&row);
        }
        *self.selected_target.borrow_mut() = None;
    }

    fn populate_tabs(self: &Rc<Self>, targets: Vec<CdpTarget>) {
        self.clear_tab_list();
        *self.browser_tabs.borrow_mut() = targets.clone();
        if targets.is_empty() {
            self.error_label.set_text(
                "No page tabs found on CDP endpoint — open a page in the browser.",
            );
            self.error_label.set_visible(true);
            return;
        }
        self.error_label.set_visible(false);
        for target in targets {
            let row = ListBoxRow::new();
            let card = Box::new(Orientation::Vertical, 2);
            let title = Label::new(Some(&target.title));
            title.set_halign(gtk::Align::Start);
            title.add_css_class("heading");
            let url = Label::new(Some(&target.url));
            url.set_halign(gtk::Align::Start);
            url.add_css_class("dim-label");
            url.set_wrap(true);
            url.set_max_width_chars(40);
            card.append(&title);
            card.append(&url);
            row.set_child(Some(&card));
            self.tab_list.append(&row);
        }
        if let Some(first) = self.browser_tabs.borrow().first().cloned() {
            *self.selected_target.borrow_mut() = Some(first);
        }
        let tab = Rc::clone(self);
        glib::idle_add_local_once(move || {
            tab.suppress_tab_select.set(true);
            if let Some(row) = tab.tab_list.row_at_index(0) {
                tab.tab_list.select_row(Some(&row));
            }
            let suppress = tab.suppress_tab_select.clone();
            glib::idle_add_local_once(move || {
                suppress.set(false);
            });
        });
    }

    fn show_pick(&self, pick: PickedElement) {
        self.selector_label
            .set_text(&format!("Element path: {}", pick.selector));
        let text = format_element_view(&pick);
        let buf = self.html_view.buffer();
        buf.set_text(&text);
        *self.picked_element.borrow_mut() = Some(pick);
    }
}

pub fn build_canvas_tab(app: &adw::Application, state: Arc<AppState>) -> Rc<CanvasTab> {
    let ipc_bridge = GtkPaneEventBridge::new();
    let ipc_ctx =
        sispace_core::services::pane_ipc::pane_ipc_ctx(state.as_ref(), ipc_bridge.dispatcher());
    CanvasTab::new(app, state, ipc_ctx, ipc_bridge)
}
