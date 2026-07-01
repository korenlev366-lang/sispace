use std::cell::{Cell, RefCell};
use std::f64::consts::PI;
use std::rc::Rc;

use gtk::cairo;
use gtk::prelude::*;
use gtk::{DrawingArea, GestureClick};
use sispace_core::services::swarm_workspace::{SiswarmWorkspaceState, SwarmMessageEdge};

const NODE_R: f64 = 22.0;

#[derive(Clone)]
pub struct NodeLayout {
    pub role: &'static str,
    pub x: f64,
    pub y: f64,
    pub pane_id: Option<String>,
    pub gate_locked: bool,
}

pub struct SwarmVisualizer {
    area: DrawingArea,
    state: Rc<RefCell<Option<SiswarmWorkspaceState>>>,
    focused_pane: Rc<RefCell<Option<String>>>,
    on_select: Rc<RefCell<Option<Rc<dyn Fn(&str)>>>>,
    needs_redraw: Rc<Cell<bool>>,
}

impl SwarmVisualizer {
    pub fn new() -> Self {
        let area = DrawingArea::new();
        area.set_content_height(240);
        area.set_hexpand(true);
        area.set_vexpand(false);

        let state = Rc::new(RefCell::new(None));
        let focused_pane = Rc::new(RefCell::new(None));
        let on_select: Rc<RefCell<Option<Rc<dyn Fn(&str)>>>> = Rc::new(RefCell::new(None));
        let needs_redraw = Rc::new(Cell::new(true));

        let draw_state = Rc::clone(&state);
        let draw_focus = Rc::clone(&focused_pane);
        let draw_needs = Rc::clone(&needs_redraw);
        area.set_draw_func(move |_area, cr, width, height| {
            let w = width as f64;
            let h = height as f64;
            cr.set_source_rgb(0.12, 0.12, 0.14);
            let _ = cr.paint();
            if let Some(ref st) = *draw_state.borrow() {
                let nodes = compute_layout(st, w, h);
                let mut edges = default_edges(st);
                edges.extend(st.edges.iter().cloned());
                draw_edges(cr, &nodes, &edges);
                for n in &nodes {
                    let focused = draw_focus
                        .borrow()
                        .as_deref()
                        .map(|id| n.pane_id.as_deref() == Some(id))
                        .unwrap_or(false);
                    draw_node(cr, n, focused);
                }
                draw_gate_pills(cr, st, w);
            } else {
                cr.set_source_rgb(0.55, 0.55, 0.58);
                let _ = cr.select_font_face("Sans", cairo::FontSlant::Normal, cairo::FontWeight::Normal);
                let _ = cr.set_font_size(13.0);
                let _ = cr.move_to(16.0, h * 0.5);
                let _ = cr.show_text("Launch SISwarm to show the agent graph.");
            }
            draw_needs.set(false);
        });

        let click_state = Rc::clone(&state);
        let click_focus = Rc::clone(&focused_pane);
        let click_cb = Rc::clone(&on_select);
        let click_area = area.clone();
        let click_needs = Rc::clone(&needs_redraw);
        let gesture = GestureClick::new();
        gesture.connect_pressed(move |_, _n_press, x, y| {
            let Some(ref st) = *click_state.borrow() else {
                return;
            };
            let w = click_area.width() as f64;
            let h = click_area.height() as f64;
            if w <= 0.0 || h <= 0.0 {
                return;
            }
            let nodes = compute_layout(st, w, h);
            for n in &nodes {
                let dx = x - n.x;
                let dy = y - n.y;
                if dx * dx + dy * dy <= (NODE_R + 8.0) * (NODE_R + 8.0) {
                    if let Some(ref pid) = n.pane_id {
                        let already = click_focus.borrow().as_deref() == Some(pid.as_str());
                        if !already {
                            *click_focus.borrow_mut() = Some(pid.clone());
                            request_redraw(&click_area, &click_needs);
                        }
                        if let Some(ref f) = *click_cb.borrow() {
                            f(pid);
                        }
                    }
                    break;
                }
            }
        });
        area.add_controller(gesture);

        Self {
            area,
            state,
            focused_pane,
            on_select,
            needs_redraw,
        }
    }

    pub fn widget(&self) -> &DrawingArea {
        &self.area
    }

    pub fn set_state(&self, state: Option<SiswarmWorkspaceState>) {
        if states_equal(&self.state.borrow(), &state) {
            return;
        }
        *self.state.borrow_mut() = state;
        self.request_redraw();
    }

    pub fn set_focused_pane(&self, pane_id: Option<&str>) {
        let next = pane_id.map(str::to_string);
        if *self.focused_pane.borrow() == next {
            return;
        }
        *self.focused_pane.borrow_mut() = next;
        self.request_redraw();
    }

    pub fn set_on_select<F: Fn(&str) + 'static>(&self, f: F) {
        *self.on_select.borrow_mut() = Some(Rc::new(f));
    }

    fn request_redraw(&self) {
        if self.needs_redraw.get() {
            return;
        }
        self.needs_redraw.set(true);
        self.area.queue_draw();
    }
}

fn request_redraw(area: &DrawingArea, needs_redraw: &Cell<bool>) {
    if needs_redraw.get() {
        return;
    }
    needs_redraw.set(true);
    area.queue_draw();
}

fn states_equal(
    current: &Option<SiswarmWorkspaceState>,
    next: &Option<SiswarmWorkspaceState>,
) -> bool {
    match (current, next) {
        (None, None) => true,
        (Some(a), Some(b)) => {
            serde_json::to_string(a).ok() == serde_json::to_string(b).ok()
        }
        _ => false,
    }
}

fn compute_layout(state: &SiswarmWorkspaceState, width: f64, height: f64) -> Vec<NodeLayout> {
    let mut nodes = Vec::new();
    let cx = width * 0.5;
    let coordinator = state.bindings.iter().find(|b| b.role == "coordinator");
    if let Some(c) = coordinator {
        nodes.push(NodeLayout {
            role: "coordinator",
            x: cx,
            y: 36.0,
            pane_id: Some(c.pane_id.clone()),
            gate_locked: c.gate_locked,
        });
    }

    let workers: Vec<_> = state.bindings.iter().filter(|b| b.role == "worker").collect();
    let n = workers.len().max(1) as f64;
    let span = (width - 80.0).max(120.0);
    let start = cx - span * 0.5;
    for (i, w) in workers.iter().enumerate() {
        let x = if workers.len() == 1 {
            cx
        } else {
            start + (span * i as f64) / (n - 1.0)
        };
        nodes.push(NodeLayout {
            role: "worker",
            x,
            y: height * 0.42,
            pane_id: Some(w.pane_id.clone()),
            gate_locked: w.gate_locked,
        });
    }

    let tail_y = height - 48.0;
    if let Some(v) = state.bindings.iter().find(|b| b.role == "verifier") {
        nodes.push(NodeLayout {
            role: "verifier",
            x: cx - 70.0,
            y: tail_y,
            pane_id: Some(v.pane_id.clone()),
            gate_locked: v.gate_locked,
        });
    }
    if let Some(s) = state.bindings.iter().find(|b| b.role == "synthesizer") {
        nodes.push(NodeLayout {
            role: "synthesizer",
            x: cx + 70.0,
            y: tail_y,
            pane_id: Some(s.pane_id.clone()),
            gate_locked: s.gate_locked,
        });
    }
    nodes
}

fn default_edges(state: &SiswarmWorkspaceState) -> Vec<SwarmMessageEdge> {
    let mut edges = Vec::new();
    let worker_count = state.bindings.iter().filter(|b| b.role == "worker").count();
    for _ in 0..worker_count {
        edges.push(SwarmMessageEdge {
            from_role: "coordinator".into(),
            to_role: "worker".into(),
            label: "assign".into(),
            timestamp: String::new(),
        });
    }
    if state.graph.verifier.is_some() {
        edges.push(SwarmMessageEdge {
            from_role: "workers".into(),
            to_role: "verifier".into(),
            label: "gate".into(),
            timestamp: String::new(),
        });
    }
    if state.graph.synthesizer.is_some() {
        edges.push(SwarmMessageEdge {
            from_role: "verifier".into(),
            to_role: "synthesizer".into(),
            label: "gate".into(),
            timestamp: String::new(),
        });
    }
    edges
}

fn role_point(nodes: &[NodeLayout], role: &str) -> Option<(f64, f64)> {
    if role == "worker" || role == "workers" {
        let ys: Vec<f64> = nodes
            .iter()
            .filter(|n| n.role == "worker")
            .map(|n| n.y)
            .collect();
        if ys.is_empty() {
            return None;
        }
        let y = ys.iter().sum::<f64>() / ys.len() as f64;
        let xs: Vec<f64> = nodes
            .iter()
            .filter(|n| n.role == "worker")
            .map(|n| n.x)
            .collect();
        let x = xs.iter().sum::<f64>() / xs.len() as f64;
        return Some((x, y));
    }
    nodes
        .iter()
        .find(|n| n.role == role)
        .map(|n| (n.x, n.y))
}

fn draw_edges(cr: &cairo::Context, nodes: &[NodeLayout], edges: &[SwarmMessageEdge]) {
    for e in edges {
        let from = role_point(nodes, &e.from_role);
        let to = role_point(nodes, &e.to_role);
        if let (Some((x1, y1)), Some((x2, y2))) = (from, to) {
            cr.set_source_rgb(0.45, 0.48, 0.55);
            cr.set_line_width(1.5);
            if e.label == "gate" {
                cr.set_dash(&[5.0, 4.0], 0.0);
            } else {
                cr.set_dash(&[], 0.0);
            }
            cr.move_to(x1, y1);
            cr.line_to(x2, y2);
            let _ = cr.stroke();
            cr.set_dash(&[], 0.0);
        }
    }
}

fn draw_node(cr: &cairo::Context, n: &NodeLayout, focused: bool) {
    let (fr, fg, fb) = if n.gate_locked && (n.role == "verifier" || n.role == "synthesizer") {
        (0.45, 0.45, 0.48)
    } else if n.role == "verifier" || n.role == "synthesizer" {
        (0.25, 0.75, 0.4)
    } else {
        (0.35, 0.55, 0.9)
    };

    if focused {
        cr.set_source_rgb(0.95, 0.85, 0.35);
        let _ = cr.arc(n.x, n.y, NODE_R + 4.0, 0.0, 2.0 * PI);
        let _ = cr.fill();
    }

    cr.set_source_rgb(fr, fg, fb);
    let _ = cr.arc(n.x, n.y, NODE_R, 0.0, 2.0 * PI);
    let _ = cr.fill();

    cr.set_source_rgb(0.95, 0.95, 0.97);
    let _ = cr.select_font_face("Sans", cairo::FontSlant::Normal, cairo::FontWeight::Bold);
    let _ = cr.set_font_size(10.0);
    let label = n.role;
    let extents = cr.text_extents(label).ok();
    if let Some(ext) = extents {
        let _ = cr.move_to(n.x - ext.width() * 0.5, n.y + 4.0);
        let _ = cr.show_text(label);
    }
}

fn draw_gate_pills(cr: &cairo::Context, state: &SiswarmWorkspaceState, width: f64) {
    let _ = cr.select_font_face("Sans", cairo::FontSlant::Normal, cairo::FontWeight::Normal);
    let _ = cr.set_font_size(11.0);
    let w1 = format!(
        "workers {}",
        if state.graph.workers_complete { "✓" } else { "…" }
    );
    let w2 = format!(
        "verifier {}",
        if state.graph.verifier_passed { "✓" } else { "…" }
    );
    cr.set_source_rgb(0.75, 0.78, 0.82);
    let _ = cr.move_to(12.0, 14.0);
    let _ = cr.show_text(&w1);
    let _ = cr.move_to(width - 120.0, 14.0);
    let _ = cr.show_text(&w2);
}
