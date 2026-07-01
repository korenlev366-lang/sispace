//! Headless-friendly smoke test when `SISPACE_GTK_SMOKE=1`.
//! Cycles every tab, checks harness snapshot loaded, prints `SISPACE_GTK_SMOKE_OK`.

use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use adw::Application;
use gtk::glib;

use crate::ui::harness::HarnessPanel;
use crate::MainTabs;

const SMOKE_OK: &str = "SISPACE_GTK_SMOKE_OK";

pub fn enabled() -> bool {
    std::env::var("SISPACE_GTK_SMOKE").is_ok()
}

pub fn schedule(
    app: &Application,
    tabs: &Rc<MainTabs>,
    harness: Rc<HarnessPanel>,
) {
    if !enabled() {
        return;
    }
    eprintln!("sispace-gtk: smoke test starting…");
    let app = app.clone();
    let tabs = Rc::clone(tabs);
    glib::timeout_add_local_once(Duration::from_secs(8), move || {
        smoke_step(app, tabs, harness, 0);
    });
}

fn smoke_step(
    app: Application,
    tabs: Rc<MainTabs>,
    harness: Rc<HarnessPanel>,
    step: u32,
) {
    match step {
        0 => {
            tabs.select_by_title("SISpace");
            eprintln!("sispace-gtk: smoke selected tab SISpace");
            glib::timeout_add_local_once(Duration::from_millis(1000), move || {
                smoke_step(app, tabs, harness, 1);
            });
        }
        1 => {
            tabs.select_by_title("SISwarm");
            eprintln!("sispace-gtk: smoke selected tab SISwarm");
            glib::timeout_add_local_once(Duration::from_millis(1000), move || {
                smoke_step(app, tabs, harness, 2);
            });
        }
        2 => {
            tabs.select_by_title("SICanvas");
            eprintln!("sispace-gtk: smoke selected tab SICanvas");
            glib::timeout_add_local_once(Duration::from_millis(1000), move || {
                smoke_step(app, tabs, harness, 3);
            });
        }
        3 => {
            tabs.select_by_title("Harness");
            eprintln!("sispace-gtk: smoke selected tab Harness");
            harness.ensure_snapshot_loaded();
            glib::timeout_add_local_once(Duration::from_millis(2000), move || {
                smoke_step(app, tabs, harness, 4);
            });
        }
        _ => {
            let (rollouts, proposals) = harness.snapshot_counts();
            eprintln!("sispace-gtk: smoke rollouts={rollouts} proposals={proposals}");
            if rollouts == 0 && proposals == 0 {
                eprintln!("sispace-gtk: smoke WARN harness snapshot empty (check harness/memory)");
            }
            eprintln!("sispace-gtk: {SMOKE_OK}");
            app.quit();
        }
    }
}
