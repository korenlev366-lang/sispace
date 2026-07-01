//! SICanvas — Chrome DevTools Protocol client for external browser attach.

use std::net::TcpStream;
use std::process::Command;
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tungstenite::{connect, Message, WebSocket};
use tungstenite::stream::MaybeTlsStream;

pub const DEFAULT_CDP_PORT: u16 = 9222;

pub const BROWSER_LAUNCH_HINT: &str =
    "chromium --remote-debugging-port=9222";

#[derive(Debug, Clone, Deserialize)]
pub struct CdpTarget {
    pub id: String,
    pub title: String,
    pub url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    pub web_socket_debugger_url: Option<String>,
    #[serde(rename = "type")]
    pub target_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PickedElement {
    pub html: String,
    pub css: String,
    pub selector: String,
}

/// Scan `ps aux` for Chromium/Firefox started with `--remote-debugging-port`.
pub fn detect_remote_debugging_port() -> Option<u16> {
    let output = Command::new("ps").args(["aux"]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        if !line.contains("--remote-debugging-port") {
            continue;
        }
        if line.contains("grep") && line.contains("remote-debugging-port") {
            continue;
        }
        if let Some(port) = parse_debugging_port(line) {
            return Some(port);
        }
    }
    None
}

fn parse_debugging_port(line: &str) -> Option<u16> {
    const PREFIX: &str = "--remote-debugging-port";
    const PREFIX_EQ: &str = "--remote-debugging-port=";

    if let Some(idx) = line.find(PREFIX_EQ) {
        let rest = &line[idx + PREFIX_EQ.len()..];
        let port_str: String = rest
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        return port_str.parse().ok();
    }
    if let Some(idx) = line.find(PREFIX) {
        let rest = line[idx + PREFIX.len()..].trim_start();
        if rest.starts_with('=') {
            let port_str: String = rest[1..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            return port_str.parse().ok();
        }
        let token = rest.split_whitespace().next()?;
        let port_str: String = token
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        return port_str.parse().ok();
    }
    None
}

pub fn list_browser_tabs(port: u16) -> Result<Vec<CdpTarget>, String> {
    let url = format!("http://127.0.0.1:{port}/json");
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let targets: Vec<CdpTarget> = client
        .get(&url)
        .send()
        .map_err(|e| format!("CDP /json request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("CDP /json HTTP error: {e}"))?
        .json()
        .map_err(|e| format!("CDP /json parse failed: {e}"))?;
    Ok(targets
        .into_iter()
        .filter(|t| t.target_type == "page" && t.web_socket_debugger_url.is_some())
        .collect())
}

const PICKER_INJECT: &str = r#"(function(){if(window.__sicanvasCleanup)window.__sicanvasCleanup();let overlay=null;function cssPath(el){if(!el||el.nodeType!==1)return'';const parts=[];while(el&&el.nodeType===1&&el!==document.documentElement){let sel=el.tagName.toLowerCase();if(el.id){sel+='#'+el.id;parts.unshift(sel);break;}const parent=el.parentElement;if(parent){const siblings=Array.from(parent.children).filter(c=>c.tagName===el.tagName);if(siblings.length>1){sel+=':nth-of-type('+(siblings.indexOf(el)+1)+')';}}parts.unshift(sel);el=parent;}return parts.join(' > ');}function styles(el){const cs=getComputedStyle(el);return['display','position','width','height','margin','padding','color','background-color','font-size','font-family','border','border-radius'].map(k=>k+': '+cs.getPropertyValue(k)).join('; ');}function onOver(e){if(overlay)overlay.remove();const t=e.target;if(!t||t===document.body)return;const r=t.getBoundingClientRect();overlay=document.createElement('div');overlay.style.cssText='position:fixed;pointer-events:none;border:2px solid #3b82f6;z-index:2147483647;background:rgba(59,130,246,0.1);top:'+r.top+'px;left:'+r.left+'px;width:'+r.width+'px;height:'+r.height+'px;';document.body.appendChild(overlay);}function onClick(e){e.preventDefault();e.stopPropagation();const t=e.target;window.__sicanvasPick=JSON.stringify({html:t.outerHTML,css:styles(t),selector:cssPath(t)});cleanup();}function cleanup(){document.removeEventListener('mouseover',onOver,true);document.removeEventListener('click',onClick,true);if(overlay)overlay.remove();window.__sicanvasCleanup=null;}window.__sicanvasCleanup=cleanup;window.__sicanvasPick=null;document.addEventListener('mouseover',onOver,true);document.addEventListener('click',onClick,true);})();"#;

struct CdpSession {
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: u32,
}

impl CdpSession {
    fn connect(ws_url: &str) -> Result<Self, String> {
        let (socket, _) = connect(ws_url).map_err(|e| format!("CDP WebSocket connect failed: {e}"))?;
        Ok(Self {
            socket,
            next_id: 1,
        })
    }

    fn call(&mut self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = serde_json::json!({ "id": id, "method": method, "params": params });
        self.socket
            .send(Message::Text(payload.to_string()))
            .map_err(|e| format!("CDP send failed: {e}"))?;

        loop {
            match self
                .socket
                .read()
                .map_err(|e| format!("CDP read failed: {e}"))?
            {
                Message::Text(text) => {
                    let msg: serde_json::Value =
                        serde_json::from_str(&text).map_err(|e| format!("CDP JSON parse: {e}"))?;
                    if msg.get("id").and_then(|v| v.as_u64()) != Some(id as u64) {
                        continue;
                    }
                    if let Some(err) = msg.get("error") {
                        return Err(err.to_string());
                    }
                    return Ok(msg.get("result").cloned().unwrap_or(serde_json::Value::Null));
                }
                Message::Close(_) => return Err("CDP WebSocket closed".to_string()),
                Message::Ping(data) => {
                    let _ = self.socket.send(Message::Pong(data));
                }
                _ => {}
            }
        }
    }

    fn evaluate(&mut self, expression: &str) -> Result<serde_json::Value, String> {
        let result = self.call(
            "Runtime.evaluate",
            serde_json::json!({ "expression": expression, "returnByValue": true }),
        )?;
        Ok(result
            .get("result")
            .and_then(|r| r.get("value"))
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }
}

/// Inject hover/click picker JS and poll until the user clicks an element.
pub fn pick_element(ws_url: &str, timeout: Duration) -> Result<PickedElement, String> {
    let mut session = CdpSession::connect(ws_url)?;
    let _ = session.call("Runtime.enable", serde_json::json!({}))?;
    session.evaluate(PICKER_INJECT)?;

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        let value = session.evaluate("window.__sicanvasPick")?;
        if value.is_null() {
            continue;
        }
        let raw = value
            .as_str()
            .ok_or_else(|| "pick result was not a string".to_string())?;
        return serde_json::from_str(raw).map_err(|e| format!("pick JSON parse failed: {e}"));
    }
    Err("Element pick timed out — click an element in the browser".to_string())
}

pub fn format_element_view(pick: &PickedElement) -> String {
    format!(
        "<!-- selector: {} -->\n\n{}\n\n/* computed styles */\n{}",
        pick.selector, pick.html, pick.css
    )
}

pub fn build_agent_prompt(user_prompt: &str, pick: &PickedElement) -> String {
    format!(
        "[SICanvas element context]\nSelector: {}\nComputed CSS: {}\nHTML:\n{}\n\nUser prompt: {}",
        pick.selector, pick.css, pick.html, user_prompt.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_debugging_port_equals_form() {
        let line = "/usr/bin/chromium --remote-debugging-port=9222 --user-data-dir=/tmp/x";
        assert_eq!(parse_debugging_port(line), Some(9222));
    }

    #[test]
    fn parse_debugging_port_space_form() {
        let line = "firefox --remote-debugging-port 9333 --profile /tmp";
        assert_eq!(parse_debugging_port(line), Some(9333));
    }

    #[test]
    fn format_element_view_includes_selector() {
        let pick = PickedElement {
            html: "<div>hi</div>".to_string(),
            css: "display: block".to_string(),
            selector: "body > div".to_string(),
        };
        let view = format_element_view(&pick);
        assert!(view.contains("body > div"));
        assert!(view.contains("<div>hi</div>"));
    }
}
