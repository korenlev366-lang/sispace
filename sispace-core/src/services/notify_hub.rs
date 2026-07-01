use std::sync::Mutex;

use crate::services::pane_ipc::PaneEventDispatcher;

static PENDING_PANE_FOCUS: Mutex<Option<String>> = Mutex::new(None);

pub fn set_pending_pane_focus(pane_id: &str) {
    if let Ok(mut guard) = PENDING_PANE_FOCUS.lock() {
        *guard = Some(pane_id.to_string());
    }
}

pub fn take_pending_pane_focus() -> Option<String> {
    PENDING_PANE_FOCUS
        .lock()
        .ok()
        .and_then(|mut g| g.take())
}

pub fn push_ntfy(server: &str, topic: &str, title: &str, message: &str, tags: &[&str]) {
    let topic = topic.trim();
    if topic.is_empty() {
        return;
    }
    let server = server.trim_end_matches('/');
    let url = format!("{server}/{}", urlencoding::encode(topic));
    let tag_header = tags.join(",");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build();
    let Ok(client) = client else {
        return;
    };
    let mut req = client
        .post(&url)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Title", title)
        .body(message.to_string());
    if !tag_header.is_empty() {
        req = req.header("Tags", tag_header);
    }
    let _ = req.send();
}

pub fn notify_agent_complete(
    events: &dyn PaneEventDispatcher,
    pane_id: &str,
    title: &str,
    summary: &str,
) {
    set_pending_pane_focus(pane_id);
    let body = if summary.is_empty() {
        format!("Pane {pane_id} finished an agent turn.")
    } else {
        format!("{title}: {summary}")
    };

    events.dispatch(
        "notification:pane-ready",
        serde_json::json!({
            "paneId": pane_id,
            "title": title,
            "body": body,
            "desktopTitle": "SISpace · Agent complete",
        }),
    );

    let root = crate::services::node_host::project_root();
    let ntfy = crate::services::config::load_ntfy_config(&root);
    push_ntfy(
        &ntfy.server,
        &ntfy.topic,
        "SISpace agent complete",
        &body,
        &["sispace", "agent_complete"],
    );
}

pub fn notify_gate_unlock(events: &dyn PaneEventDispatcher, role: &str, root_id: &str) {
    let body = format!("Swarm gate unlocked: {role} ready (root {root_id})");
    events.dispatch(
        "notification:gate-unlock",
        serde_json::json!({
            "role": role,
            "rootId": root_id,
            "body": body,
            "desktopTitle": "SISpace · Swarm gate",
        }),
    );
    let root = crate::services::node_host::project_root();
    let ntfy = crate::services::config::load_ntfy_config(&root);
    push_ntfy(
        &ntfy.server,
        &ntfy.topic,
        "SISpace swarm gate",
        &body,
        &["sispace", "swarm_gate"],
    );
}
