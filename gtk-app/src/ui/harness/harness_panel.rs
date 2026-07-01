use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::mpsc;
use std::time::Duration;

use gtk::glib;
use gtk::prelude::*;
use gtk::{
    Box, Button, Label, ListBox, ListBoxRow, Orientation, Paned, ProgressBar, ScrolledWindow,
    SearchEntry, TextView, Widget,
};
use sispace_core::services::doctor::run_harness_doctor;
use sispace_core::services::hp_snapshot::{
    build_snapshot, spawn_panel_script, spawn_reflect_chain, HarnessLedgerEntry,
    HarnessPanelSnapshot, RolloutTimelineEntry,
};
use sispace_core::services::node_host::project_root;

const MAX_ENTRY_ROWS: usize = 100;

#[derive(Clone, Copy, PartialEq, Eq)]
enum HarnessSection {
    MetaReadiness,
    Proposals,
    Accepted,
    Rejected,
    Patterns,
    Rollout,
    UserModel,
    Reports,
}

impl HarnessSection {
    const ALL: [HarnessSection; 8] = [
        Self::MetaReadiness,
        Self::Proposals,
        Self::Accepted,
        Self::Rejected,
        Self::Patterns,
        Self::Rollout,
        Self::UserModel,
        Self::Reports,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::MetaReadiness => "Meta-readiness",
            Self::Proposals => "Proposals",
            Self::Accepted => "Accepted",
            Self::Rejected => "Rejected",
            Self::Patterns => "Patterns",
            Self::Rollout => "Rollout",
            Self::UserModel => "User Model",
            Self::Reports => "Reports",
        }
    }

    fn shows_entry_list(self) -> bool {
        matches!(
            self,
            Self::Proposals | Self::Accepted | Self::Rejected | Self::Patterns | Self::Rollout
        )
    }
}

enum BgMsg {
    Snapshot(Result<HarnessPanelSnapshot, String>),
    Action(Result<String, String>),
    Doctor(Result<(String, i32), String>),
}

struct PanelState {
    snapshot: Option<HarnessPanelSnapshot>,
    section: HarnessSection,
    selected_ledger_id: Option<String>,
    selected_rollout_id: Option<String>,
    pattern_filter: String,
}

enum EntryListRows {
    Ledger(Vec<HarnessLedgerEntry>),
    Rollout(Vec<RolloutTimelineEntry>),
}

pub struct HarnessPanel {
    root: Box,
    state: Rc<RefCell<PanelState>>,
    suppress_entry_select: Rc<Cell<bool>>,
    suppress_section_select: Rc<Cell<bool>>,
    in_rebuild: Rc<Cell<bool>>,
    bg_tx: mpsc::Sender<BgMsg>,
    section_list: ListBox,
    entry_list: ListBox,
    entry_scroll: ScrolledWindow,
    pattern_search: SearchEntry,
    detail_view: TextView,
    meta_box: Box,
    doctor_view: TextView,
    status_label: Label,
    error_label: Label,
    action_label: Label,
}

impl HarnessPanel {
    pub fn widget(&self) -> &Widget {
        self.root.upcast_ref()
    }

    /// Rollout and pending-proposal counts from the last loaded snapshot (for smoke tests).
    pub fn snapshot_counts(&self) -> (usize, usize) {
        self.state
            .borrow()
            .snapshot
            .as_ref()
            .map(|s| (s.rollout_entries.len(), s.pending_proposals.len()))
            .unwrap_or((0, 0))
    }

    fn new() -> Rc<Self> {
        let (bg_tx, bg_rx) = mpsc::channel();
        let state = Rc::new(RefCell::new(PanelState {
            snapshot: None,
            section: HarnessSection::Proposals,
            selected_ledger_id: None,
            selected_rollout_id: None,
            pattern_filter: String::new(),
        }));

        let root = Box::new(Orientation::Vertical, 0);
        root.set_vexpand(true);
        root.set_hexpand(true);

        let header = Box::new(Orientation::Vertical, 4);
        header.set_margin_top(12);
        header.set_margin_start(12);
        header.set_margin_end(12);
        let title = Label::new(Some("Harness management"));
        title.add_css_class("title-2");
        let sub = Label::new(Some(
            "Meta-readiness, proposals, rollout log — Accept/Reject per proposal; Apply all runs every pending proposal.",
        ));
        sub.set_wrap(true);
        sub.add_css_class("dim-label");
        header.append(&title);
        header.append(&sub);
        root.append(&header);

        let toolbar = Box::new(Orientation::Horizontal, 6);
        toolbar.set_margin_start(12);
        toolbar.set_margin_end(12);
        toolbar.set_margin_bottom(8);
        let refresh_btn = Button::with_label("Refresh");
        let reflect_btn = Button::with_label("Reflect");
        let grade_btn = Button::with_label("Grade");
        let accept_btn = Button::with_label("Accept");
        let reject_btn = Button::with_label("Reject");
        let apply_btn = Button::with_label("Apply all");
        let curate_btn = Button::with_label("Curate");
        let doctor_btn = Button::with_label("Doctor");
        for b in [
            &refresh_btn,
            &reflect_btn,
            &grade_btn,
            &accept_btn,
            &reject_btn,
            &apply_btn,
            &curate_btn,
            &doctor_btn,
        ] {
            toolbar.append(b);
        }
        root.append(&toolbar);

        let status_label = Label::new(None);
        status_label.add_css_class("dim-label");
        status_label.set_margin_start(12);
        status_label.set_halign(gtk::Align::Start);
        root.append(&status_label);

        let error_label = Label::new(None);
        error_label.add_css_class("error");
        error_label.set_wrap(true);
        error_label.set_margin_start(12);
        error_label.set_margin_end(12);
        error_label.set_visible(false);
        root.append(&error_label);

        let action_label = Label::new(None);
        action_label.add_css_class("success");
        action_label.set_wrap(true);
        action_label.set_margin_start(12);
        action_label.set_margin_end(12);
        action_label.set_visible(false);
        root.append(&action_label);

        let paned = Paned::new(Orientation::Horizontal);
        paned.set_vexpand(true);
        paned.set_hexpand(true);
        paned.set_position(220);

        let section_list = ListBox::new();
        section_list.add_css_class("navigation-sidebar");
        // Avoid row-selected → rebuild during first map (stack overflow in TabView).
        section_list.set_selection_mode(gtk::SelectionMode::None);
        for (i, section) in HarnessSection::ALL.iter().enumerate() {
            let row = ListBoxRow::new();
            row.set_child(Some(&Label::new(Some(section.label()))));
            row.set_widget_name(&i.to_string());
            section_list.append(&row);
        }
        let section_scroll = ScrolledWindow::builder()
            .min_content_width(180)
            .build();
        section_scroll.set_child(Some(&section_list));

        let right = Box::new(Orientation::Vertical, 6);
        right.set_margin_top(8);
        right.set_margin_start(8);
        right.set_margin_end(8);
        right.set_margin_bottom(8);
        right.set_vexpand(true);

        let pattern_search = SearchEntry::builder()
            .placeholder_text("Filter patterns…")
            .build();
        pattern_search.set_visible(false);
        right.append(&pattern_search);

        let entry_list = ListBox::new();
        entry_list.set_selection_mode(gtk::SelectionMode::None);
        let entry_scroll = ScrolledWindow::builder()
            .min_content_height(140)
            .vexpand(false)
            .hexpand(true)
            .build();
        entry_scroll.set_child(Some(&entry_list));
        right.append(&entry_scroll);

        let meta_box = Box::new(Orientation::Vertical, 8);
        meta_box.set_visible(false);
        meta_box.set_vexpand(true);
        right.append(&meta_box);

        let detail_view = TextView::new();
        detail_view.set_editable(false);
        detail_view.set_monospace(true);
        detail_view.set_vexpand(true);
        let detail_scroll = ScrolledWindow::builder().vexpand(true).build();
        detail_scroll.set_child(Some(&detail_view));
        right.append(&detail_scroll);

        paned.set_start_child(Some(&section_scroll));
        paned.set_end_child(Some(&right));
        root.append(&paned);

        let doctor_title = Label::new(Some("Harness doctor"));
        doctor_title.add_css_class("heading");
        doctor_title.set_margin_start(12);
        doctor_title.set_margin_top(8);
        root.append(&doctor_title);

        let doctor_view = TextView::new();
        doctor_view.set_editable(false);
        doctor_view.set_monospace(true);
        let doctor_scroll = ScrolledWindow::builder()
            .min_content_height(100)
            .margin_start(12)
            .margin_end(12)
            .margin_bottom(12)
            .build();
        doctor_scroll.set_child(Some(&doctor_view));
        root.append(&doctor_scroll);

        let panel = Rc::new(Self {
            root,
            state,
            suppress_entry_select: Rc::new(Cell::new(false)),
            suppress_section_select: Rc::new(Cell::new(false)),
            in_rebuild: Rc::new(Cell::new(false)),
            bg_tx,
            section_list,
            entry_list,
            entry_scroll,
            pattern_search,
            detail_view,
            meta_box,
            doctor_view,
            status_label,
            error_label,
            action_label,
        });

        let poll = Rc::clone(&panel);
        glib::timeout_add_local(Duration::from_millis(32), move || {
            while let Ok(msg) = bg_rx.try_recv() {
                poll.handle_bg(msg);
            }
            glib::ControlFlow::Continue
        });

        panel.wire_events(
            refresh_btn,
            reflect_btn,
            grade_btn,
            accept_btn,
            reject_btn,
            apply_btn,
            curate_btn,
            doctor_btn,
        );

        let panel_for_map = Rc::clone(&panel);
        glib::idle_add_local_once(move || {
        panel_for_map.suppress_section_select.set(true);
        panel_for_map.rebuild_right_pane();
        let suppress = panel_for_map.suppress_section_select.clone();
        glib::idle_add_local_once(move || {
            suppress.set(false);
        });
        panel_for_map
            .section_list
            .set_selection_mode(gtk::SelectionMode::Single);
    });

        panel
    }

    /// Load harness ledger data once (deferred until Harness tab is shown).
    pub fn ensure_snapshot_loaded(self: &Rc<Self>) {
        if self.state.borrow().snapshot.is_some() {
            return;
        }
        if self.status_label.text().as_str() == "Refreshing snapshot…" {
            return;
        }
        self.refresh_snapshot();
    }

    fn wire_events(
        self: &Rc<Self>,
        refresh: Button,
        reflect: Button,
        grade: Button,
        accept: Button,
        reject: Button,
        apply: Button,
        curate: Button,
        doctor: Button,
    ) {
        let p = Rc::clone(self);
        refresh.connect_clicked(move |_| p.refresh_snapshot());

        let p = Rc::clone(self);
        reflect.connect_clicked(move |_| {
            p.run_bg_action(|root| spawn_reflect_chain(root));
        });

        let p = Rc::clone(self);
        grade.connect_clicked(move |_| {
            p.run_bg_action(|root| spawn_panel_script(root, "grade", &[]));
        });

        let p = Rc::clone(self);
        accept.connect_clicked(move |_| {
            let id = match p.selected_proposal_id() {
                Ok(id) => id,
                Err(e) => {
                    p.set_error(&e);
                    return;
                }
            };
            p.run_bg_action(move |root| spawn_panel_script(root, "accept", &["--proposal-id", &id]));
        });

        let p = Rc::clone(self);
        reject.connect_clicked(move |_| {
            let id = match p.selected_proposal_id() {
                Ok(id) => id,
                Err(e) => {
                    p.set_error(&e);
                    return;
                }
            };
            p.run_bg_action(move |root| spawn_panel_script(root, "reject", &["--proposal-id", &id]));
        });

        let p = Rc::clone(self);
        apply.connect_clicked(move |_| {
            p.run_bg_action(|root| spawn_panel_script(root, "apply", &[]));
        });

        let p = Rc::clone(self);
        curate.connect_clicked(move |_| {
            p.run_bg_action(|root| spawn_panel_script(root, "curate", &[]));
        });

        let p = Rc::clone(self);
        doctor.connect_clicked(move |_| p.run_doctor());

        let p = Rc::clone(self);
        self.section_list.connect_row_selected(move |_, row| {
            if p.suppress_section_select.get() {
                return;
            }
            let idx = row.map(|r| r.index()).unwrap_or(0) as usize;
            if let Some(section) = HarnessSection::ALL.get(idx) {
                let mut st = p.state.borrow_mut();
                st.section = *section;
                st.selected_ledger_id = None;
                st.selected_rollout_id = None;
            }
            p.rebuild_right_pane();
        });

        let p = Rc::clone(self);
        self.entry_list.connect_row_selected(move |_, row| {
            if p.suppress_entry_select.get() {
                return;
            }
            let name = row.map(|r| r.widget_name().to_string()).unwrap_or_default();
            {
                let mut st = p.state.borrow_mut();
                match st.section {
                    HarnessSection::Rollout => st.selected_rollout_id = Some(name),
                    _ => st.selected_ledger_id = Some(name),
                }
            }
            p.update_detail_text();
        });

        let p = Rc::clone(self);
        self.pattern_search.connect_search_changed(move |entry| {
            p.state.borrow_mut().pattern_filter = entry.text().to_string();
            p.rebuild_entry_list();
        });
    }

    fn refresh_snapshot(self: &Rc<Self>) {
        self.set_status("Refreshing snapshot…");
        self.clear_error();
        let tx = self.bg_tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(BgMsg::Snapshot(build_snapshot(None)));
        });
    }

    fn selected_proposal_id(&self) -> Result<String, String> {
        let st = self.state.borrow();
        if st.section != HarnessSection::Proposals {
            return Err("Select a proposal in the Proposals section first.".into());
        }
        st.selected_ledger_id
            .clone()
            .ok_or_else(|| "Select a proposal to accept or reject.".into())
    }

    fn run_bg_action<F>(self: &Rc<Self>, f: F)
    where
        F: FnOnce(&std::path::Path) -> Result<String, String> + Send + 'static,
    {
        self.set_status("Running action…");
        self.clear_error();
        let tx = self.bg_tx.clone();
        let root = project_root();
        std::thread::spawn(move || {
            let _ = tx.send(BgMsg::Action(f(&root)));
        });
    }

    fn run_doctor(self: &Rc<Self>) {
        self.set_status("Running doctor…");
        self.clear_error();
        let tx = self.bg_tx.clone();
        let root = project_root();
        std::thread::spawn(move || {
            let result = run_harness_doctor(&root).map_err(|e| e.to_string());
            let _ = tx.send(BgMsg::Doctor(result));
        });
    }

    fn handle_bg(self: &Rc<Self>, msg: BgMsg) {
        match msg {
            BgMsg::Snapshot(result) => {
                self.set_status("");
                match result {
                    Ok(snap) => {
                        self.state.borrow_mut().snapshot = Some(snap);
                        self.update_section_labels();
                        let panel = Rc::clone(self);
                        glib::timeout_add_local_once(Duration::from_millis(120), move || {
                            panel.rebuild_right_pane();
                            panel
                                .entry_list
                                .set_selection_mode(gtk::SelectionMode::Single);
                        });
                    }
                    Err(e) => self.set_error(&e),
                }
            }
            BgMsg::Action(result) => {
                self.set_status("");
                match result {
                    Ok(msg) => {
                        self.set_action_msg(&msg);
                        self.refresh_snapshot();
                    }
                    Err(e) => self.set_error(&e),
                }
            }
            BgMsg::Doctor(result) => {
                self.set_status("");
                match result {
                    Ok((report, code)) => {
                        self.doctor_view.buffer().set_text(&report);
                        self.set_action_msg(&format!("Doctor finished (exit {code})"));
                    }
                    Err(e) => self.set_error(&e),
                }
            }
        }
    }

    fn set_status(&self, text: &str) {
        self.status_label.set_text(text);
    }

    fn set_error(&self, msg: &str) {
        self.error_label.set_text(msg);
        self.error_label.set_visible(true);
        self.action_label.set_visible(false);
    }

    fn clear_error(&self) {
        self.error_label.set_visible(false);
    }

    fn set_action_msg(&self, msg: &str) {
        self.action_label.set_text(msg);
        self.action_label.set_visible(true);
    }

    fn rebuild_right_pane(self: &Rc<Self>) {
        if self.in_rebuild.get() {
            return;
        }
        self.in_rebuild.set(true);
        let section = self.state.borrow().section;
        self.pattern_search
            .set_visible(section == HarnessSection::Patterns);
        self.entry_scroll
            .set_visible(section.shows_entry_list());
        self.meta_box
            .set_visible(section == HarnessSection::MetaReadiness);
        self.detail_view
            .set_visible(section != HarnessSection::MetaReadiness);

        match section {
            HarnessSection::MetaReadiness => self.rebuild_meta_box(),
            HarnessSection::Reports => self.show_reports(),
            HarnessSection::UserModel => self.show_user_model(),
            _ => {
                self.rebuild_entry_list();
                self.update_detail_text();
            }
        }
        let guard = self.in_rebuild.clone();
        glib::idle_add_local_once(move || {
            guard.set(false);
        });
    }

    fn rebuild_meta_box(&self) {
        while let Some(child) = self.meta_box.first_child() {
            self.meta_box.remove(&child);
        }
        let Some(snap) = self.state.borrow().snapshot.clone() else {
            self.meta_box.append(&Label::new(Some("No snapshot loaded.")));
            return;
        };
        let meta = &snap.meta_readiness;
        let ready = Label::new(Some(if meta.overall_ready {
            "READY for meta-optimization loop"
        } else {
            "NOT READY for meta-optimization loop"
        }));
        ready.add_css_class(if meta.overall_ready { "success" } else { "warning" });
        self.meta_box.append(&ready);

        for m in &meta.milestones {
            let row = Box::new(Orientation::Vertical, 4);
            let head = Box::new(Orientation::Horizontal, 8);
            let title = Label::new(Some(&format!("{}. {}", m.id, m.title)));
            title.set_hexpand(true);
            title.set_halign(gtk::Align::Start);
            head.append(&title);
            head.append(&Label::new(Some(&format!("{} / {}", m.current, m.target))));
            let badge = Label::new(Some(if m.passed { "PASS" } else { "FAIL" }));
            badge.add_css_class(if m.passed { "success" } else { "error" });
            head.append(&badge);
            row.append(&head);

            let bar = ProgressBar::new();
            let frac = (m.current as f64) / (m.target.max(1) as f64);
            bar.set_fraction(frac.min(1.0));
            bar.set_show_text(true);
            bar.set_text(Some(&format!("{:.0}%", frac * 100.0)));
            row.append(&bar);
            self.meta_box.append(&row);
        }
    }

    fn rebuild_entry_list(&self) {
        let rows = {
            let st = self.state.borrow();
            let Some(snap) = st.snapshot.as_ref() else {
                return;
            };
            match st.section {
                HarnessSection::Proposals => {
                    EntryListRows::Ledger(snap.pending_proposals.clone())
                }
                HarnessSection::Accepted => {
                    EntryListRows::Ledger(snap.accepted_lessons.clone())
                }
                HarnessSection::Rejected => {
                    EntryListRows::Ledger(snap.rejected_lessons.clone())
                }
                HarnessSection::Patterns => {
                    let q = st.pattern_filter.trim().to_lowercase();
                    let entries: Vec<_> = if q.is_empty() {
                        snap.reasoning_patterns.clone()
                    } else {
                        snap.reasoning_patterns
                            .iter()
                            .filter(|p| {
                                p.id.to_lowercase().contains(&q)
                                    || p.title.to_lowercase().contains(&q)
                                    || p.body.to_lowercase().contains(&q)
                            })
                            .cloned()
                            .collect()
                    };
                    EntryListRows::Ledger(entries)
                }
                HarnessSection::Rollout => {
                    EntryListRows::Rollout(snap.rollout_entries.clone())
                }
                _ => return,
            }
        };

        self.suppress_entry_select.set(true);
        while let Some(row) = self.entry_list.row_at_index(0) {
            self.entry_list.remove(&row);
        }
        match rows {
            EntryListRows::Ledger(entries) => append_ledger_rows(&self.entry_list, &entries),
            EntryListRows::Rollout(entries) => append_rollout_rows(&self.entry_list, &entries),
        }
        let suppress = self.suppress_entry_select.clone();
        glib::idle_add_local_once(move || {
            suppress.set(false);
        });
    }

    fn update_detail_text(&self) {
        let st = self.state.borrow();
        let text = match st.section {
            HarnessSection::Rollout => st
                .snapshot
                .as_ref()
                .and_then(|s| {
                    st.selected_rollout_id
                        .as_ref()
                        .and_then(|id| s.rollout_entries.iter().find(|e| &e.id == id))
                })
                .map(|e| e.body.clone())
                .unwrap_or_else(|| "Select a rollout entry.".into()),
            HarnessSection::Proposals
            | HarnessSection::Accepted
            | HarnessSection::Rejected
            | HarnessSection::Patterns => ledger_detail(&st),
            _ => String::new(),
        };
        self.detail_view.buffer().set_text(&text);
    }

    fn show_reports(&self) {
        let text = self
            .state
            .borrow()
            .snapshot
            .as_ref()
            .map(|s| {
                let mut out = String::new();
                if !s.latest_reflection.is_empty() {
                    out.push_str("=== latest-reflection.md ===\n\n");
                    out.push_str(&s.latest_reflection);
                }
                if !s.latest_grade.is_empty() {
                    out.push_str("\n\n=== latest-grade.md ===\n\n");
                    out.push_str(&s.latest_grade);
                }
                if out.trim().is_empty() {
                    "No reflection or grade reports yet.".to_string()
                } else {
                    out
                }
            })
            .unwrap_or_else(|| "No snapshot loaded.".into());
        self.detail_view.buffer().set_text(&text);
    }

    fn show_user_model(&self) {
        let text = self
            .state
            .borrow()
            .snapshot
            .as_ref()
            .map(|s| {
                if s.user_model.is_empty() {
                    "user-model.md is empty.".to_string()
                } else {
                    s.user_model.clone()
                }
            })
            .unwrap_or_else(|| "No snapshot loaded.".into());
        self.detail_view.buffer().set_text(&text);
    }

    fn update_section_labels(&self) {
        for (i, section) in HarnessSection::ALL.iter().enumerate() {
            if let Some(row) = self.section_list.row_at_index(i as i32) {
                let count = self.state.borrow().snapshot.as_ref().map(|s| match section {
                    HarnessSection::Proposals => s.pending_proposals.len(),
                    HarnessSection::Accepted => s.accepted_lessons.len(),
                    HarnessSection::Rejected => s.rejected_lessons.len(),
                    HarnessSection::Patterns => s.reasoning_patterns.len(),
                    HarnessSection::Rollout => s.rollout_entries.len(),
                    _ => 0,
                });
                let label = if let Some(n) = count.filter(|&n| n > 0) {
                    format!("{} ({n})", section.label())
                } else {
                    section.label().to_string()
                };
                if let Some(child) = row.child() {
                    if let Ok(lbl) = child.downcast::<Label>() {
                        lbl.set_text(&label);
                    }
                }
            }
        }
    }
}

fn append_ledger_rows(list: &ListBox, entries: &[HarnessLedgerEntry]) {
    let total = entries.len();
    let show = entries.len().min(MAX_ENTRY_ROWS);
    if show == 0 {
        let row = ListBoxRow::new();
        row.set_child(Some(&Label::new(Some("No entries."))));
        row.set_selectable(false);
        list.append(&row);
        return;
    }
    for e in &entries[..show] {
        let row = ListBoxRow::new();
        row.set_widget_name(&e.id);
        let card = Box::new(Orientation::Vertical, 2);
        card.append(&Label::new(Some(&format!("{}: {}", e.id, e.title))));
        if let Some(ref st) = e.status {
            card.append(&Label::new(Some(st)));
        }
        if let Some(ref sum) = e.summary {
            let s = Label::new(Some(sum));
            s.set_wrap(true);
            card.append(&s);
        }
        row.set_child(Some(&card));
        list.append(&row);
    }
    if total > show {
        let row = ListBoxRow::new();
        row.set_selectable(false);
        row.set_child(Some(&Label::new(Some(&format!(
            "… {total} total (showing first {show})"
        )))));
        list.append(&row);
    }
}

fn append_rollout_rows(list: &ListBox, entries: &[RolloutTimelineEntry]) {
    let total = entries.len();
    let show = entries.len().min(MAX_ENTRY_ROWS);
    if show == 0 {
        let row = ListBoxRow::new();
        row.set_child(Some(&Label::new(Some("No rollout entries."))));
        row.set_selectable(false);
        list.append(&row);
        return;
    }
    for e in &entries[..show] {
        let row = ListBoxRow::new();
        row.set_widget_name(&e.id);
        let card = Box::new(Orientation::Vertical, 2);
        card.append(&Label::new(Some(&e.id)));
        if let Some(ref ts) = e.timestamp {
            card.append(&Label::new(Some(ts)));
        }
        row.set_child(Some(&card));
        list.append(&row);
    }
    if total > show {
        let row = ListBoxRow::new();
        row.set_selectable(false);
        row.set_child(Some(&Label::new(Some(&format!(
            "… {total} rollout entries (showing first {show})"
        )))));
        list.append(&row);
    }
}

fn ledger_detail(st: &PanelState) -> String {
    let Some(snap) = st.snapshot.as_ref() else {
        return "No snapshot loaded.".into();
    };
    let entries = match st.section {
        HarnessSection::Proposals => &snap.pending_proposals,
        HarnessSection::Accepted => &snap.accepted_lessons,
        HarnessSection::Rejected => &snap.rejected_lessons,
        HarnessSection::Patterns => &snap.reasoning_patterns,
        _ => return "Select an entry.".into(),
    };
    if let Some(ref id) = st.selected_ledger_id {
        if let Some(e) = entries.iter().find(|e| e.id == *id) {
            return e.body.clone();
        }
    }
    "Select an entry to view details.".into()
}

pub fn build_harness_tab() -> Rc<HarnessPanel> {
    HarnessPanel::new()
}
