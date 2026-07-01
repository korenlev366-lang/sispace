import { loadSispaceConfigFromCwd } from "../config/sispace.js";

export interface NtfyPushOptions {
  topic: string;
  message: string;
  title?: string;
  server?: string;
  tags?: string[];
}

export interface NtfyPushResult {
  ok: boolean;
  status?: number;
  error?: string;
}

function normalizeServer(server: string): string {
  return server.replace(/\/+$/, "");
}

/** HTTP POST to ntfy (default https://ntfy.sh). */
export async function pushNtfy(opts: NtfyPushOptions): Promise<NtfyPushResult> {
  const topic = opts.topic.trim();
  if (!topic) {
    return { ok: false, error: "ntfy topic empty" };
  }

  const server = normalizeServer(opts.server?.trim() || "https://ntfy.sh");
  const url = `${server}/${encodeURIComponent(topic)}`;

  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (opts.title?.trim()) {
    headers.Title = opts.title.trim();
  }
  if (opts.tags?.length) {
    headers.Tags = opts.tags.join(",");
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: opts.message,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export interface SessionEndNotifyContext {
  cwd: string;
  sessionTitle: string;
  sessionId: string;
  notifyTopicOverride?: string;
}

/** Push session-end notification using config/sispace.yaml ntfy.topic. */
export async function pushSessionEndNotify(
  ctx: SessionEndNotifyContext,
): Promise<NtfyPushResult> {
  const cfg = loadSispaceConfigFromCwd(ctx.cwd);
  const topic = (ctx.notifyTopicOverride?.trim() || cfg.ntfy.topic).trim();
  if (!topic) {
    return { ok: false, error: "ntfy topic not configured" };
  }

  const message = `Session ended: ${ctx.sessionTitle} (${ctx.sessionId})`;
  return pushNtfy({
    topic,
    server: cfg.ntfy.server,
    title: "cursorsi",
    message,
    tags: ["cursorsi", "session_end"],
  });
}
