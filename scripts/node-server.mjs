import http from "node:http";
import { detectCursorAgent } from "../sidecar/handlers/cursor-agent.mjs";
import { runHarnessReflect, runPipelineStreaming } from "./pipeline-lib.mjs";
import { runSwarmCreate } from "./swarm-lib.mjs";

const port = 3847;

const cursorAgent = detectCursorAgent();
console.log(
  `cursor-agent: ${cursorAgent.available ? "available" : "not found"}${
    cursorAgent.path ? ` (${cursorAgent.path})` : ""
  }${cursorAgent.version ? ` ${cursorAgent.version}` : ""}`,
);
if (process.env.OBSIDIAN_API_KEY?.trim() && cursorAgent.available) {
  console.log("OpenClaw hybrid: enabled (OBSIDIAN_API_KEY + cursor-agent)");
} else if (process.env.OBSIDIAN_API_KEY?.trim()) {
  console.log("OpenClaw hybrid: disabled (cursor-agent not in PATH; SDK fallback)");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (req.method === "GET" && url === "/ping") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pong");
    return;
  }

  if (req.method === "POST" && url === "/pipeline/run") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const emit = (event) => sseWrite(res, event);
    try {
      await runPipelineStreaming(body, emit);
    } catch (err) {
      emit({
        type: "pipeline_error",
        taskId: body.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    res.end();
    return;
  }

  if (req.method === "POST" && url === "/harness/reflect") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const emit = (event) => sseWrite(res, event);
    emit({ type: "reflecting", taskId: body.taskId, status: "reflecting" });
    try {
      await runHarnessReflect(body, emit);
    } catch (err) {
      emit({
        type: "reflect_error",
        taskId: body.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    res.end();
    return;
  }

  if (req.method === "POST" && url === "/swarm/create") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const emit = (event) => sseWrite(res, event);
    emit({ type: "swarm_creating", rootId: body.rootId, status: "creating" });
    try {
      await runSwarmCreate(body, emit);
    } catch (err) {
      emit({
        type: "swarm_error",
        rootId: body.rootId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
});

server.on("error", (err) => {
  console.error(`sispace-node-server error: ${err.message}`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`sispace-node-server listening on 127.0.0.1:${port}`);
});
