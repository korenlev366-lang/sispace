mod app_state;
mod gtk_events;
mod smoke;
mod theme;
mod ui;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use adw::prelude::*;
use adw::{
    Application, ApplicationWindow, ColorScheme, HeaderBar, StyleManager, TabPage, TabView,
    ToolbarView,
};
use gtk::glib;
use gtk::gio;
use gtk::prelude::{ToggleButtonExt, WidgetExt};
use gtk::{
    gdk, style_context_add_provider_for_display, CssProvider, Stack, ToggleButton,
    STYLE_PROVIDER_PRIORITY_APPLICATION,
};
use sispace_core::services::shutdown::graceful_shutdown;
use sispace_core::state::AppState;

const APP_ID: &str = "dev.lev.sispace";

const GTK_STACK_BYTES: usize = 32 * 1024 * 1024;

fn main() {
    let handle = std::thread::Builder::new()
        .name("gtk-main".into())
        .stack_size(GTK_STACK_BYTES)
        .spawn(run_gtk_app)
        .expect("spawn GTK main thread");

    let code = handle.join().expect("GTK thread panicked");
    std::process::exit(code);
}

fn run_gtk_app() -> i32 {
    gio::resources_register_include!("icons.gresource")
        .expect("register SISpace icon resources");

    let app = Application::builder().application_id(APP_ID).build();

    app.connect_startup(|_| {
        StyleManager::default().set_color_scheme(ColorScheme::ForceDark);
        let css = CssProvider::new();
        css.load_from_string(theme::CURSORSI_THEME_CSS);
        if let Some(display) = gdk::Display::default() {
            style_context_add_provider_for_display(
                &display,
                &css,
                STYLE_PROVIDER_PRIORITY_APPLICATION,
            );
        }
    });

    let state_slot: Rc<RefCell<Option<Arc<AppState>>>> = Rc::new(RefCell::new(None));

    let state_activate = Rc::clone(&state_slot);
    app.connect_activate(move |app| {
        if app.active_window().is_some() {
            return;
        }
        let window = ApplicationWindow::builder()
            .application(app)
            .title("SISpace")
            .default_width(1200)
            .default_height(800)
            .content(&gtk::Label::new(Some("Starting SISpace…")))
            .build();

        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let state = app_state::init_app_state();
            let _ = ready_tx.send(state);
        });

        let state_slot_close = Rc::clone(&state_activate);
        let state_slot_ready = Rc::clone(&state_activate);
        let app_weak = app.downgrade();
        let window_weak = window.downgrade();
        window.connect_close_request(move |_| {
            if let Some(state) = state_slot_close.borrow().as_ref() {
                graceful_shutdown(state.as_ref());
            }
            glib::Propagation::Proceed
        });

        window.present();

        glib::idle_add_local_once(move || {
            glib::timeout_add_local(Duration::from_millis(50), move || {
                match ready_rx.try_recv() {
                    Ok(state) => {
                        *state_slot_ready.borrow_mut() = Some(Arc::clone(&state));
                        let Some(app) = app_weak.upgrade() else {
                            return glib::ControlFlow::Break;
                        };
                        let Some(window) = window_weak.upgrade() else {
                            return glib::ControlFlow::Break;
                        };
                        schedule_staggered_ui(&app, &window, state);
                        glib::ControlFlow::Break
                    }
                    Err(mpsc::TryRecvError::Empty) => glib::ControlFlow::Continue,
                    Err(mpsc::TryRecvError::Disconnected) => glib::ControlFlow::Break,
                }
            });
        });
    });

    let state_shutdown = Rc::clone(&state_slot);
    app.connect_shutdown(move |_| {
        if let Some(state) = state_shutdown.borrow().as_ref() {
            graceful_shutdown(state.as_ref());
        }
    });

    app.run().into()
}

/// TabView without Adw TabBar — TabBar tab selection can recurse in gtk_icon_theme_lookup.
///
/// Uses a single-hop deferred guard to prevent signal reentrancy: `syncing` is set
/// synchronously in the signal handler before any deferred work, avoiding the window
/// where nested `idle_add_local_once` from selected_page_notify could fire before
/// the guard clears.
pub struct MainTabs {
    view: TabView,
    strip: gtk::Box,
    group_anchor: Rc<RefCell<Option<ToggleButton>>>,
    syncing: Rc<Cell<bool>>,
    strip_buttons: Rc<RefCell<Vec<(String, ToggleButton)>>>,
}

use std::cell::Cell;

impl MainTabs {
    fn new() -> Self {
        let syncing = Rc::new(Cell::new(false));
        let strip_buttons: Rc<RefCell<Vec<(String, ToggleButton)>>> =
            Rc::new(RefCell::new(Vec::new()));
        let view = TabView::new();
        let syncing_notify = Rc::clone(&syncing);
        let buttons_notify = Rc::clone(&strip_buttons);
        view.connect_selected_page_notify(move |tv| {
            // Set guard synchronously — no window for reentrancy.
            if syncing_notify.get() {
                return;
            }
            syncing_notify.set(true);

            let Some(page) = tv.selected_page() else {
                syncing_notify.set(false);
                return;
            };
            let title = page.title().to_string();
            let syncing_clear = Rc::clone(&syncing_notify);
            let buttons_clear = Rc::clone(&buttons_notify);
            glib::idle_add_local_once(move || {
                for (t, btn) in buttons_clear.borrow().iter() {
                    btn.set_active(t == &title);
                }
                syncing_clear.set(false);
            });
        });

        Self {
            view,
            strip: gtk::Box::new(gtk::Orientation::Horizontal, 4),
            group_anchor: Rc::new(RefCell::new(None)),
            syncing,
            strip_buttons,
        }
    }

    fn install_in_window(&self, window: &ApplicationWindow) {
        self.strip.add_css_class("linked");
        let header = HeaderBar::new();
        header.set_title_widget(Some(&self.strip));
        let toolbar = ToolbarView::new();
        toolbar.add_top_bar(&header);
        toolbar.set_content(Some(&self.view));
        window.set_content(Some(&toolbar));
    }

    fn append(&self, child: &impl IsA<gtk::Widget>, title: &str) -> TabPage {
        let page = self.view.append(child);
        page.set_title(title);
        self.wire_strip_button(&page, title);
        page
    }

    fn prepend(&self, child: &impl IsA<gtk::Widget>, title: &str) -> TabPage {
        let page = self.view.prepend(child);
        page.set_title(title);
        self.wire_strip_button(&page, title);
        page
    }

    fn wire_strip_button(&self, page: &TabPage, title: &str) {
        let btn = ToggleButton::with_label(title);
        btn.add_css_class("flat");
        let anchor = self.group_anchor.borrow().clone();
        if let Some(ref a) = anchor {
            btn.set_group(Some(a));
        } else {
            *self.group_anchor.borrow_mut() = Some(btn.clone());
        }

        let view = self.view.clone();
        let page_btn = page.clone();
        let syncing = Rc::clone(&self.syncing);
        btn.connect_toggled(move |b| {
            if !b.is_active() || syncing.get() {
                return;
            }
            // Set guard synchronously before any deferred callback.
            syncing.set(true);
            let view_idle = view.clone();
            let page_idle = page_btn.clone();
            let syncing_clear = Rc::clone(&syncing);
            glib::idle_add_local_once(move || {
                view_idle.set_selected_page(&page_idle);
                syncing_clear.set(false);
            });
        });

        self.strip_buttons
            .borrow_mut()
            .push((title.to_string(), btn.clone()));
        self.strip.append(&btn);
    }

    pub fn select_by_title(&self, title: &str) {
        if self.syncing.get() {
            return;
        }
        self.syncing.set(true);
        let n = self.view.n_pages();
        for i in 0..n {
            let page = self.view.nth_page(i);
            if page.title().as_str() == title {
                let view_idle = self.view.clone();
                let page_idle = page.clone();
                let syncing_idle = Rc::clone(&self.syncing);
                let buttons_idle = Rc::clone(&self.strip_buttons);
                let title_idle = title.to_string();
                glib::idle_add_local_once(move || {
                    view_idle.set_selected_page(&page_idle);
                    for (t, btn) in buttons_idle.borrow().iter() {
                        btn.set_active(t == &title_idle);
                    }
                    syncing_idle.set(false);
                });
                return;
            }
        }
        // No matching page — clear guard so we don't deadlock.
        self.syncing.set(false);
    }

    pub fn is_syncing(&self) -> bool {
        self.syncing.get()
    }
}

/// Strong refs for tab controllers (GTK widgets alone do not keep Rust state alive).
struct TabKeepalives {
    harness: Option<Rc<ui::harness::HarnessPanel>>,
    sispace: Option<Rc<ui::sispace::SispaceTab>>,
    siswarm: Option<Rc<ui::siswarm::SiswarmTab>>,
    canvas: Option<Rc<ui::canvas::CanvasTab>>,
}

fn schedule_staggered_ui(app: &Application, window: &ApplicationWindow, state: Arc<AppState>) {
    let app = app.clone();
    let window = window.clone();
    glib::idle_add_local_once(move || {
        let tabs = Rc::new(MainTabs::new());
        tabs.install_in_window(&window);

        let keepalives = Rc::new(RefCell::new(TabKeepalives {
            harness: None,
            sispace: None,
            siswarm: None,
            canvas: None,
        }));

        let harness = ui::harness::build_harness_tab();
        keepalives.borrow_mut().harness = Some(Rc::clone(&harness));
        tabs.prepend(harness.widget(), "Harness");
        tabs.select_by_title("Harness");

        install_lazy_tabs(&app, &tabs, state, keepalives, harness.clone());
        smoke::schedule(&app, &tabs, harness);
    });
}

struct LazyTabSlot {
    stack: Stack,
    built: bool,
    building: bool,
}

fn install_lazy_tabs(
    app: &Application,
    tabs: &Rc<MainTabs>,
    state: Arc<AppState>,
    keepalives: Rc<RefCell<TabKeepalives>>,
    harness: Rc<ui::harness::HarnessPanel>,
) {
    let slots: Rc<RefCell<HashMap<String, LazyTabSlot>>> = Rc::new(RefCell::new(HashMap::new()));

    for title in ["SISpace", "SISwarm", "SICanvas"] {
        let stack = Stack::new();
        let placeholder = gtk::Label::new(Some(&format!("Loading {title}…")));
        placeholder.set_margin_top(24);
        placeholder.set_margin_bottom(24);
        stack.add_named(&placeholder, Some("placeholder"));
        stack.set_visible_child_name("placeholder");
        tabs.append(&stack, title);
        slots.borrow_mut().insert(
            title.to_string(),
            LazyTabSlot {
                stack,
                built: false,
                building: false,
            },
        );
    }

    let app_for_build = app.clone();
    let state_for_build = Arc::clone(&state);
    let slots_mount = Rc::clone(&slots);
    let keepalives_mount = Rc::clone(&keepalives);
    let harness_select = harness.clone();
    let tab_switching = ui::sispace::new_tab_switching_guard();
    ui::sispace::wire_tab_view_selected_guard(&tabs.view, tab_switching, move |title| {
        if title == "Harness" {
            harness_select.ensure_snapshot_loaded();
            return;
        }

        let mut slots_guard = slots_mount.borrow_mut();
        let Some(slot) = slots_guard.get_mut(title) else {
            return;
        };
        if slot.built {
            return;
        }
        if slot.building {
            return;
        }
        slot.building = true;
        drop(slots_guard);

        let app = app_for_build.clone();
        let state = Arc::clone(&state_for_build);
        let slots = Rc::clone(&slots_mount);
        let keepalives = Rc::clone(&keepalives_mount);
        let title = title.to_string();
        glib::idle_add_local_once(move || {
            mount_lazy_tab(&app, &state, &title, &slots, &keepalives);
        });
    });
}

fn mount_lazy_tab(
    app: &Application,
    state: &Arc<AppState>,
    title: &str,
    slots: &Rc<RefCell<HashMap<String, LazyTabSlot>>>,
    keepalives: &Rc<RefCell<TabKeepalives>>,
) {
    let mut slots_guard = slots.borrow_mut();
    let Some(slot) = slots_guard.get_mut(title) else {
        return;
    };
    if slot.built {
        return;
    }
    drop(slots_guard);

    let app = app.clone();
    let state = Arc::clone(state);
    let slots = Rc::clone(slots);
    let keepalives = Rc::clone(keepalives);
    let title = title.to_string();

    glib::timeout_add_local_once(Duration::from_millis(100), move || {
        mount_lazy_tab_inner(&app, &state, &title, &slots, &keepalives);
    });
}

fn mount_lazy_tab_inner(
    app: &Application,
    state: &Arc<AppState>,
    title: &str,
    slots: &Rc<RefCell<HashMap<String, LazyTabSlot>>>,
    keepalives: &Rc<RefCell<TabKeepalives>>,
) {
    let mut slots_guard = slots.borrow_mut();
    let Some(slot) = slots_guard.get_mut(title) else {
        return;
    };
    if slot.built {
        return;
    }

    enum MountedTab {
        Sispace(Rc<ui::sispace::SispaceTab>),
        Siswarm(Rc<ui::siswarm::SiswarmTab>),
        Canvas(Rc<ui::canvas::CanvasTab>),
    }

    let (content, mounted) = match title {
        "SISpace" => {
            let tab = ui::sispace::build_sispace_tab(app, Arc::clone(state));
            keepalives.borrow_mut().sispace = Some(Rc::clone(&tab));
            (tab.widget().clone(), MountedTab::Sispace(tab))
        }
        "SISwarm" => {
            let tab = ui::siswarm::build_siswarm_tab(app, Arc::clone(state));
            keepalives.borrow_mut().siswarm = Some(Rc::clone(&tab));
            (tab.widget().clone(), MountedTab::Siswarm(tab))
        }
        "SICanvas" => {
            let tab = ui::canvas::build_canvas_tab(app, Arc::clone(state));
            keepalives.borrow_mut().canvas = Some(Rc::clone(&tab));
            (tab.widget().clone(), MountedTab::Canvas(tab))
        }
        _ => {
            slot.building = false;
            return;
        }
    };

    if slot.stack.child_by_name("content").is_none() {
        slot.stack.add_named(&content, Some("content"));
    }
    slot.built = true;
    slot.building = false;
    if slot.stack.visible_child_name().as_deref() != Some("content") {
        slot.stack.set_visible_child_name("content");
    }

    match mounted {
        MountedTab::Sispace(tab) => tab.finish_mount(app),
        MountedTab::Siswarm(tab) => tab.finish_mount(),
        MountedTab::Canvas(tab) => tab.finish_mount(),
    }
}
