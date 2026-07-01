use serde_json::Value;

/// One-line summary for the meta-orchestrator feed (mirrors `src/lib/pane-events.ts`).
pub fn summarize_pane_event(payload: &Value) -> String {
    let event_type = payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("event");
    let p = payload.get("payload").unwrap_or(payload);

    match event_type {
        "session_start" => {
            let model = p.get("model").and_then(|v| v.as_str()).unwrap_or("?");
            format!("session started · model {model}")
        }
        "session_end" => {
            let reason = p.get("reason").and_then(|v| v.as_str()).unwrap_or("unknown");
            format!("session ended · {reason}")
        }
        "step_start" => {
            let index = p.get("index").map(|v| v.to_string()).unwrap_or_else(|| "?".into());
            let total = p.get("total").map(|v| v.to_string()).unwrap_or_else(|| "?".into());
            let agent = p.get("agent").and_then(|v| v.as_str()).unwrap_or("agent");
            format!("step {index}/{total} · {agent}")
        }
        "step_done" => {
            let agent = p.get("agent").and_then(|v| v.as_str()).unwrap_or("agent");
            let status = p.get("status").and_then(|v| v.as_str()).unwrap_or("");
            format!("step done · {agent} · {status}")
        }
        "agent_complete" => {
            let summary = p
                .get("summary")
                .or_else(|| p.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("agent complete · {summary}")
        }
        "agent_turn" => {
            let role = p.get("role").and_then(|v| v.as_str()).unwrap_or("turn");
            let text = p.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let short = if text.len() > 120 {
                format!("{}…", &text[..120])
            } else {
                text.to_string()
            };
            format!("{role}: {short}")
        }
        "cost_update" => {
            let session = p
                .get("sessionTokens")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "0".into());
            let task = p
                .get("taskTokens")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "0".into());
            format!("tokens session={session} task={task}")
        }
        "goal_status" => {
            let summary = p
                .get("summary")
                .or_else(|| p.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("goal · {summary}")
        }
        "reflection_started" => "reflection started".to_string(),
        "reflection_done" => {
            let proposal = p
                .get("proposalId")
                .and_then(|v| v.as_str())
                .unwrap_or("none");
            format!("reflection done · proposal {proposal}")
        }
        "error" => {
            let message = p.get("message").and_then(|v| v.as_str()).unwrap_or("");
            format!("error · {message}")
        }
        other => other.to_string(),
    }
}

pub fn format_token_count(tokens: i64) -> String {
    let n = tokens.max(0);
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.0)
    } else if n >= 1_000 {
        format!("{:.1}k", n as f64 / 1_000.0)
    } else {
        n.to_string()
    }
}

pub fn pane_id_from_payload(payload: &Value) -> Option<String> {
    payload
        .get("paneId")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

pub fn event_type_from_payload(payload: &Value) -> String {
    payload
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("ipc-event")
        .to_string()
}

pub fn is_meta_feed_channel(channel: &str) -> bool {
    matches!(
        channel,
        "pane:session-start"
            | "pane:session-end"
            | "pane:step-start"
            | "pane:step-done"
            | "pane:agent-complete"
            | "pane:agent-turn"
            | "pane:cost-update"
            | "pane:goal-status"
            | "pane:reflection-started"
            | "pane:reflection-done"
            | "pane:error"
            | "pane:ipc-event"
    )
}
