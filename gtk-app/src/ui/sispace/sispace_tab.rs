use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;

use adw::{prelude::*, Application, TabView};
use gtk::glib;
use gtk::gio;
use gtk::{Box, Button, Label, Orientation, Paned, Widget};

use crate::ui::presets_dialog::PresetsDialog;
use sispace_core::services::node_host::project_root;
use sispace_core::services::pane_ipc::{pane_ipc_ctx, PaneIpcContext};
use sispace_core::state::AppState;

use crate::gtk_events::GtkPaneEventBridge;

use super::meta_panel::MetaPanel;
use super::session_sidebar::SessionSidebar;
use super::sispace_ui::SispacePaneUi;
use super::terminal_column::TerminalColumn;

/// Shared guard for AdwTabView `selected-page` notify while SISpace lazy-mounts.
pub type TabSwitchingGuard = Rc<Cell<bool>>;

pub fn new_tab_switching_guard() -> TabSwitchingGuard {
    Rc::new(Cell::new(false))
}

/// Returns `false` when a tab switch is already in progress (caller should return immediately).
pub fn try_begin_tab_switch(guard: &TabSwitchingGuard) -> bool {
    if guard.get() {
        return false;
    }
    guard.set(true);
    true
}

pub fn defer_clear_tab_switching(guard: &TabSwitchingGuard) {
    let guard = Rc::clone(guard);
    glib::idle_add_local_once(move || {
        guard.set(false);
    });
}

/// Wire `selected-page` notify with a reentrancy guard (used from main lazy-tab mount).
pub fn wire_tab_view_selected_guard(
    tab_view: &TabView,
    tab_switching: TabSwitchingGuard,
    on_selected: impl Fn(&str) + 'static,
) {
    let on_selected = Rc::new(on_selected);
    tab_view.connect_selected_page_notify(move |tv| {
        if tab_switching.get() {
            return;
        }
        let Some(page) = tv.selected_page() else {
            return;
        };
        if !try_begin_tab_switch(&tab_switching) {
            return;
        }
        let title = page.title().to_string();
        let guard = Rc::clone(&tab_switching);
        let on_selected = Rc::clone(&on_selected);
        glib::idle_add_local_once(move || {
            on_selected(&title);
            defer_clear_tab_switching(&guard);
        });
    });
}

struct SispaceTabInner {
    // No fields needed — the Rc<SispacePaneUi> is held alive by closures
    // (spawn_btn, presets_btn) and GtkPaneEventBridge internal storage.
}

/// SISpace tab root widget (sidebar + meta-orchestrator + VTE column).
#[allow(dead_code)]
pub struct SispaceTab {
    root: Box,
    inner: RefCell<Option<SispaceTabInner>>,
    paned: Paned,
    term_host: Box,
    left_host: Box,
    spawn_btn: Button,
    presets_btn: Button,
    cwd_state: Rc<RefCell<String>>,
    folder_btn: Button,
    path_label: Label,
    error_label: Label,
    session_count_label: Label,
    quick_sispace: Button,
    quick_gnu: Button,
    quick_home: Button,
    dir_group: Box,
    quick_picks: Rc<Vec<(Button, String)>>,
    ipc_ctx: PaneIpcContext,
    ipc_bridge: GtkPaneEventBridge,
    state: Arc<AppState>,
}

impl SispaceTab {
    pub fn new(
        _app: &Application,
        state: Arc<AppState>,
        ipc_ctx: PaneIpcContext,
        ipc_bridge: GtkPaneEventBridge,
    ) -> Rc<Self> {
        let root = Box::new(Orientation::Vertical, 0);
        root.set_vexpand(true);
        root.set_hexpand(true);

        // Shared working-directory state (default to sispace repo root)
        let cwd_state: Rc<RefCell<String>> = Rc::new(RefCell::new(
            project_root().to_string_lossy().into_owned(),
        ));

        let status_bar = Box::new(Orientation::Horizontal, 6);
        status_bar.add_css_class("cursorsi-statusbar");
        status_bar.set_halign(gtk::Align::Fill);
        status_bar.set_hexpand(true);

        let brand = Label::new(Some("CURSORSI"));
        brand.add_css_class("cursorsi-brand");
        let sep1 = Label::new(Some("·"));
        sep1.add_css_class("cursorsi-sep");
        let mode = Label::new(Some("DESKTOP"));
        mode.add_css_class("cursorsi-mode-chat");
        let sep2 = Label::new(Some("·"));
        sep2.add_css_class("cursorsi-sep");
        let session_count_label = Label::new(Some("0 sessions"));
        session_count_label.add_css_class("session-count-chip");
        status_bar.append(&brand);
        status_bar.append(&sep1);
        status_bar.append(&mode);
        status_bar.append(&sep2);
        status_bar.append(&session_count_label);

        let toolbar = Box::new(Orientation::Horizontal, 8);
        toolbar.set_margin_top(4);
        toolbar.set_margin_start(8);
        toolbar.set_margin_end(8);

        let spawn_btn = Button::with_label("New Terminal");
        spawn_btn.add_css_class("cursorsi-action");
        spawn_btn.set_sensitive(false);
        let presets_btn = Button::with_label("Presets");
        presets_btn.set_sensitive(false);
        toolbar.append(&spawn_btn);
        toolbar.append(&presets_btn);

        // Folder picker button (small icon next to New Terminal)
        let folder_btn = Button::with_label("📁");
        folder_btn.add_css_class("flat");
        folder_btn.add_css_class("folder-btn");
        folder_btn.set_tooltip_text(Some("Choose working directory for new terminals"));
        folder_btn.set_sensitive(false);

        // Truncated path display (last 2 components)
        let path_label = Label::new(None);
        path_label.add_css_class("dir-path");
        path_label.set_hexpand(false);
        path_label.set_xalign(0.0);

        // Quick-pick directory buttons
        let quick_sispace = make_quick_pick_btn("sispace", "/home/lev/sispace");
        let quick_gnu = make_quick_pick_btn("GNUClient", "/home/lev/linux minecraft thing");
        let quick_home = make_quick_pick_btn("home", "/home/lev");

        // Store quick-pick buttons + their paths for active-class sync
        let quick_picks = Rc::new(vec![
            (quick_sispace.clone(), "/home/lev/sispace".to_string()),
            (quick_gnu.clone(), "/home/lev/linux minecraft thing".to_string()),
            (quick_home.clone(), "/home/lev".to_string()),
        ]);

        // Wire quick-pick callbacks — also update active class
        {
            let cwd = Rc::clone(&cwd_state);
            let lbl = path_label.clone();
            let picks = Rc::clone(&quick_picks);
            quick_sispace.connect_clicked(move |_| {
                *cwd.borrow_mut() = "/home/lev/sispace".to_string();
                update_path_label(&lbl, &cwd.borrow());
                for (btn, path) in picks.iter() {
                    if *path == "/home/lev/sispace" {
                        btn.add_css_class("active");
                    } else {
                        btn.remove_css_class("active");
                    }
                }
            });
        }
        {
            let cwd = Rc::clone(&cwd_state);
            let lbl = path_label.clone();
            let picks = Rc::clone(&quick_picks);
            quick_gnu.connect_clicked(move |_| {
                *cwd.borrow_mut() = "/home/lev/linux minecraft thing".to_string();
                update_path_label(&lbl, &cwd.borrow());
                for (btn, path) in picks.iter() {
                    if *path == "/home/lev/linux minecraft thing" {
                        btn.add_css_class("active");
                    } else {
                        btn.remove_css_class("active");
                    }
                }
            });
        }
        {
            let cwd = Rc::clone(&cwd_state);
            let lbl = path_label.clone();
            let picks = Rc::clone(&quick_picks);
            quick_home.connect_clicked(move |_| {
                *cwd.borrow_mut() = "/home/lev".to_string();
                update_path_label(&lbl, &cwd.borrow());
                for (btn, path) in picks.iter() {
                    if *path == "/home/lev" {
                        btn.add_css_class("active");
                    } else {
                        btn.remove_css_class("active");
                    }
                }
            });
        }

        // Directory pill: group folder + path + quick-picks into one container
        // The `.dir-path` border-right acts as the thin separator between path and quick-picks.
        let dir_group = Box::new(Orientation::Horizontal, 0);
        dir_group.add_css_class("dir-group");
        dir_group.set_halign(gtk::Align::End);

        dir_group.append(&folder_btn);
        dir_group.append(&path_label);
        dir_group.append(&quick_sispace);
        dir_group.append(&quick_gnu);
        dir_group.append(&quick_home);

        // Add the dir-group pill to the toolbar (replaces scattered controls)
        toolbar.append(&dir_group);

        let error_label = Label::new(None);
        error_label.add_css_class("error");
        error_label.set_wrap(true);
        error_label.set_visible(false);
        toolbar.append(&error_label);

        root.append(&status_bar);
        root.append(&toolbar);

        let paned = Paned::new(Orientation::Horizontal);
        paned.set_vexpand(true);
        paned.set_hexpand(true);
        paned.set_shrink_start_child(false);
        paned.set_shrink_end_child(true);
        paned.set_resize_start_child(false);
        paned.set_resize_end_child(true);
        paned.set_position(220);

        let left_host = Box::new(Orientation::Vertical, 0);
        left_host.set_vexpand(true);
        left_host.set_hexpand(false);
        left_host.set_width_request(220);

        let term_host = Box::new(Orientation::Vertical, 0);
        term_host.set_vexpand(true);
        term_host.set_hexpand(true);

        paned.set_start_child(Some(&left_host));
        paned.set_end_child(Some(&term_host));
        root.append(&paned);

        let tab = Rc::new(Self {
            root,
            inner: RefCell::new(None),
            paned,
            term_host,
            left_host,
            spawn_btn,
            presets_btn,
            cwd_state,
            folder_btn,
            path_label,
            error_label,
            session_count_label,
            quick_sispace,
            quick_gnu,
            quick_home,
            dir_group,
            quick_picks,
            ipc_ctx,
            ipc_bridge,
            state,
        });

        tab
    }

    pub fn finish_mount(self: &Rc<Self>, app: &Application) {
        if self.inner.borrow().is_some() {
            return;
        }
        let tab = Rc::clone(self);
        let app = app.clone();
        glib::idle_add_local_once(move || {
            tab.populate_pane_ui(&app);
        });
    }

    fn populate_pane_ui(self: &Rc<Self>, app: &Application) {
        if self.inner.borrow().is_some() {
            return;
        }
        let state = Arc::clone(&self.state);
        let column = Rc::new(RefCell::new(TerminalColumn::new(
            Arc::clone(&state.pane_manager),
            self.ipc_ctx.clone(),
        )));

        let sidebar = SessionSidebar::new(
            Arc::clone(&state.pane_manager),
            Rc::clone(&column),
        );
        let meta = MetaPanel::new(Arc::clone(&state.pane_manager), Rc::clone(&column));
        let ui = Rc::new(SispacePaneUi::new(
            sidebar,
            meta,
            Rc::clone(&column),
        ));

        let count_lbl = self.session_count_label.clone();
        let pm_count = Arc::clone(&state.pane_manager);
        ui.set_on_pane_list_changed(Rc::new(move || {
            refresh_session_count_label(&count_lbl, &pm_count);
        }));

        let sidebar_head = Box::new(Orientation::Vertical, 4);
        sidebar_head.set_margin_top(8);
        sidebar_head.set_margin_start(8);
        sidebar_head.set_margin_end(8);
        let sidebar_title = Label::new(Some("Sessions"));
        sidebar_title.add_css_class("title-4");
        sidebar_title.add_css_class("cursorsi-brand");
        sidebar_head.append(&sidebar_title);
        let sidebar_hint = Label::new(Some(
            "● active │ ○ idle │ IPC status │ Ink TUI in VTE panes",
        ));
        sidebar_hint.set_wrap(true);
        sidebar_hint.add_css_class("dim-label");
        sidebar_head.append(&sidebar_hint);
        self.left_host.append(&sidebar_head);

        refresh_session_count_label(&self.session_count_label, &state.pane_manager);

        *self.inner.borrow_mut() = Some(SispaceTabInner {
        });

        ui.wire_close_handlers();

        ui.sidebar.widget().set_vexpand(true);
        self.left_host.append(ui.sidebar.widget());
        ui.meta.widget().set_vexpand(false);
        self.left_host.append(ui.meta.widget());

        let term_placeholder = Label::new(Some(
            "Click “Spawn terminal” to attach a VTE pane.",
        ));
        term_placeholder.set_vexpand(true);
        term_placeholder.set_margin_top(24);
        self.term_host.append(&term_placeholder);

        let ui_sync = Rc::clone(&ui);
        glib::idle_add_local_once(move || {
            ui_sync.sidebar.sync_from_manager();
        });

        self.spawn_btn.set_sensitive(true);
        self.presets_btn.set_sensitive(true);

        let presets_dialog: Rc<RefCell<Option<Rc<PresetsDialog>>>> = Rc::new(RefCell::new(None));
        let app_weak = app.downgrade();
        let state_presets = Arc::clone(&state);
        let ipc_presets = self.ipc_ctx.clone();
        let column_presets = Rc::clone(&column);
        let ui_presets = Rc::clone(&ui);
        self.presets_btn.connect_clicked(move |_| {
            let mut guard = presets_dialog.borrow_mut();
            if guard.is_none() {
                *guard = Some(PresetsDialog::new(
                    Arc::clone(&state_presets),
                    ipc_presets.clone(),
                    Rc::clone(&column_presets),
                    Rc::clone(&ui_presets),
                ));
            }
            if let Some(application) = app_weak.upgrade() {
                if let Some(win) = application.active_window() {
                    if let Some(dialog) = guard.as_ref() {
                        dialog.present(Some(&win));
                    }
                }
            }
        });

        let project_root_path = project_root();
        let app_for_browse = app.downgrade();

        // Initial path display + active-class sync
        update_path_label(&self.path_label, &self.cwd_state.borrow());
        sync_active_quick_pick(&self.cwd_state.borrow(), &*self.quick_picks);

        // Wire folder button: opens a FileDialog and updates shared cwd_state
        let cwd_for_folder = Rc::clone(&self.cwd_state);
        let path_lbl_for_folder = self.path_label.clone();
        let initial_folder = gio::File::for_path(&project_root_path);
        let fallback_for_browse = project_root_path.clone();
        let quick_picks_ref = Rc::clone(&self.quick_picks);
        self.folder_btn.set_sensitive(true);
        self.folder_btn.connect_clicked(move |_| {
            let dialog = gtk::FileDialog::builder()
                .title("Select working directory for terminal")
                .initial_folder(&initial_folder)
                .accept_label("Select")
                .build();
            let cwd = Rc::clone(&cwd_for_folder);
            let fb = fallback_for_browse.clone();
            let lbl = path_lbl_for_folder.clone();
            let picks = Rc::clone(&quick_picks_ref);
            dialog.select_folder(
                app_for_browse
                    .upgrade()
                    .and_then(|app| app.active_window())
                    .as_ref(),
                None::<&gio::Cancellable>,
                move |result| {
                    let path = match result {
                        Ok(file) => file.path().unwrap_or_else(|| fb),
                        Err(_) => return,
                    };
                    let s = path.to_string_lossy().into_owned();
                    update_path_label(&lbl, &s);
                    *cwd.borrow_mut() = s.clone();
                    // Sync active class after directory change
                    sync_active_quick_pick(&s, &*picks);
                },
            );
        });

        // Wire spawn button: show SpawnDialog for the chosen cwd, then spawn terminal there
        let spawn_cwd = Rc::clone(&self.cwd_state);
        let spawn_column = Rc::clone(&column);
        let spawn_ui = Rc::clone(&ui);
        let spawn_count_lbl = self.session_count_label.clone();
        let spawn_pm = Arc::clone(&state.pane_manager);
        let spawn_paned = self.paned.downgrade();
        let spawn_term_host = self.term_host.clone();
        let spawn_project_root = project_root_path.clone();
        let spawn_err_lbl = self.error_label.clone();
        self.spawn_btn.connect_clicked(move |_| {
            // Read the current cwd from shared state
            let cwd = {
                let c = spawn_cwd.borrow();
                if c.is_empty() {
                    spawn_project_root.to_string_lossy().into_owned()
                } else {
                    c.clone()
                }
            };

            // Validate it's a real directory
            let path = std::path::Path::new(&cwd);
            if !path.is_dir() {
                spawn_err_lbl.set_text(&format!("Not a valid directory: {cwd}"));
                spawn_err_lbl.set_visible(true);
                return;
            }

            // Spawn terminal directly on the column
            let result = {
                let col = spawn_column.borrow();
                col.spawn_and_focus(&cwd)
            };

            match result {
                Ok(info) => {
                    spawn_ui.on_pane_spawned(&info.id);

                    // Swap placeholder for terminal column widget
                    let col = spawn_column.borrow();
                    let widget = col.widget().clone();
                    while let Some(child) = spawn_term_host.first_child() {
                        spawn_term_host.remove(&child);
                    }
                    spawn_term_host.append(&widget);
                    if let Some(paned) = spawn_paned.upgrade() {
                        paned.set_end_child(Some(&spawn_term_host));
                    }
                    spawn_err_lbl.set_visible(false);
                    refresh_session_count_label(&spawn_count_lbl, &spawn_pm);
                }
                Err(err) => {
                    spawn_err_lbl.set_text(&err);
                    spawn_err_lbl.set_visible(true);
                }
            }
        });

        self.ipc_bridge.attach(app, Rc::clone(&ui));
    }

    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }
}

pub fn build_sispace_tab(app: &Application, state: Arc<AppState>) -> Rc<SispaceTab> {
    let ipc_bridge = GtkPaneEventBridge::new();
    let ipc_ctx = pane_ipc_ctx(state.as_ref(), ipc_bridge.dispatcher());
    SispaceTab::new(app, state, ipc_ctx, ipc_bridge)
}

fn make_quick_pick_btn(label: &str, path: &str) -> Button {
    let btn = Button::with_label(label);
    btn.add_css_class("flat");
    btn.add_css_class("qp");
    btn.set_tooltip_text(Some(&format!("Set working directory to {path}")));
    btn
}

/// Update which quick-pick button is marked active based on current cwd.
/// The `quick_btns` array should contain the three quick-pick buttons,
/// and `quick_paths` their corresponding full paths.
/// Set `.active` on whichever quick-pick button matches the current cwd.
fn sync_active_quick_pick(cwd: &str, quick_picks: &[(Button, String)]) {
    for (btn, path) in quick_picks {
        let is_active = cwd == *path
            || cwd.starts_with(path.as_str())
            || path.starts_with(cwd);
        if is_active {
            btn.add_css_class("active");
        } else {
            btn.remove_css_class("active");
        }
    }
}

fn update_path_label(label: &Label, cwd: &str) {
    // Show only the last 2 path components (or full path if shorter)
    let path = std::path::Path::new(cwd);
    let components: Vec<&str> = path
        .components()
        .filter_map(|c| {
            let s = c.as_os_str().to_str()?;
            if s == "/" {
                None
            } else {
                Some(s)
            }
        })
        .collect();
    let n = components.len();
    let display = if n <= 2 {
        cwd.to_string()
    } else {
        format!("…/{}/{}", components[n - 2], components[n - 1])
    };
    label.set_text(&display);
}

fn refresh_session_count_label(
    label: &Label,
    pane_manager: &sispace_core::services::pane::PaneManager,
) {
    let n = pane_manager.list().len();
    let text = if n == 1 {
        "1 session".to_string()
    } else {
        format!("{n} sessions")
    };
    label.set_text(&text);
}
