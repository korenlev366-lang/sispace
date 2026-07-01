use std::cell::Cell;
use std::rc::Rc;
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use adw::Application;
use adw::glib;
use gtk::gio::Notification;
use gtk::prelude::*;
use serde_json::Value;
use sispace_core::services::notify_hub;
use sispace_core::services::pane_ipc::PaneEventDispatcher;

use crate::ui::sispace::SispacePaneUi;
use crate::ui::siswarm::SiswarmTab;

enum UiMessage {
    Dispatch { channel: String, payload: Value },
}

pub struct GtkPaneEventDispatcher {
    tx: mpsc::Sender<UiMessage>,
}

impl GtkPaneEventDispatcher {
    fn new(tx: mpsc::Sender<UiMessage>) -> Arc<Self> {
        Arc::new(Self { tx })
    }
}

impl PaneEventDispatcher for GtkPaneEventDispatcher {
    fn dispatch(&self, channel: &str, payload: Value) {
        let _ = self.tx.send(UiMessage::Dispatch {
            channel: channel.to_string(),
            payload,
        });
    }
}

/// Owns the IPC→GTK bridge; keep alive for the tab lifetime.
#[derive(Clone)]
pub struct GtkPaneEventBridge {
    dispatcher: Arc<GtkPaneEventDispatcher>,
    rx: Arc<Mutex<mpsc::Receiver<UiMessage>>>,
    siswarm: Arc<Mutex<Option<Rc<SiswarmTab>>>>,
    ui: Arc<Mutex<Option<Rc<SispacePaneUi>>>>,
    started: Rc<Cell<bool>>,
    app: Arc<Mutex<Option<Application>>>,
}

impl GtkPaneEventBridge {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            dispatcher: GtkPaneEventDispatcher::new(tx),
            rx: Arc::new(Mutex::new(rx)),
            siswarm: Arc::new(Mutex::new(None)),
            ui: Arc::new(Mutex::new(None)),
            started: Rc::new(Cell::new(false)),
            app: Arc::new(Mutex::new(None)),
        }
    }

    pub fn dispatcher(&self) -> Arc<dyn PaneEventDispatcher> {
        Arc::clone(&self.dispatcher) as Arc<dyn PaneEventDispatcher>
    }

    pub fn attach(&self, app: &Application, ui: Rc<SispacePaneUi>) {
        if let Ok(mut guard) = self.ui.lock() {
            *guard = Some(ui);
        }
        if let Ok(mut guard) = self.app.lock() {
            *guard = Some(app.clone());
        }
        self.start_loop();
    }

    /// Register SISwarm tab handlers and poll this bridge's dispatcher (separate from SISpace tab).
    pub fn attach_siswarm(&self, tab: Rc<SiswarmTab>) {
        if let Ok(mut guard) = self.siswarm.lock() {
            *guard = Some(tab);
        }
        self.start_loop();
    }

    fn start_loop(&self) {
        if self.started.get() {
            return;
        }
        self.started.set(true);

        let rx = Arc::clone(&self.rx);
        let siswarm = Arc::clone(&self.siswarm);
        let ui_ref = Arc::clone(&self.ui);
        let app_ref = Arc::clone(&self.app);

        glib::timeout_add_local(Duration::from_millis(32), move || {
            let msg = match rx.lock() {
                Ok(guard) => guard.try_recv(),
                Err(_) => return glib::ControlFlow::Break,
            };
            match msg {
                Ok(UiMessage::Dispatch { channel, payload }) => {
                    if let Ok(guard) = ui_ref.lock() {
                        if let Some(ui) = guard.as_ref() {
                            ui.handle_dispatch(&channel, &payload);
                        }
                    }
                    if let Ok(guard) = siswarm.lock() {
                        if let Some(tab) = guard.as_ref() {
                            tab.on_ipc_dispatch(&channel, &payload);
                        }
                    }
                    if channel == "notification:pane-ready" {
                        if let Ok(guard) = app_ref.lock() {
                            if let Some(app) = guard.as_ref() {
                                show_agent_complete_notification(app, &payload);
                            }
                        }
                        if let Ok(guard) = ui_ref.lock() {
                            if let Some(ui) = guard.as_ref() {
                                if let Some(pane_id) = notify_hub::take_pending_pane_focus() {
                                    ui.focus_pane(&pane_id);
                                }
                            }
                        }
                    }
                }
                Err(mpsc::TryRecvError::Empty) => {}
                Err(mpsc::TryRecvError::Disconnected) => {
                    return glib::ControlFlow::Break;
                }
            }
            glib::ControlFlow::Continue
        });
    }
}

fn show_agent_complete_notification(app: &Application, payload: &Value) {
    let title = payload
        .get("desktopTitle")
        .and_then(|v| v.as_str())
        .unwrap_or("SISpace · Agent complete");
    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("Agent turn finished.");
    let pane_id = payload
        .get("paneId")
        .and_then(|v| v.as_str())
        .unwrap_or("agent-complete");

    let notification = Notification::new(title);
    notification.set_body(Some(body));
    app.send_notification(Some(&format!("sispace-{pane_id}")), &notification);
}
