/**
 * Credentials helpers + /auth slash command wiring.
 * Run: node tests/verify-cursorsi-auth.mjs
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

assert(existsSync(path.join(root, "cli/src/config/credentials.ts")), "credentials.ts");
assert(existsSync(path.join(root, "cli/src/commands/auth.ts")), "auth.ts");
assert(existsSync(path.join(root, "cli/src/sdk/compatible-agent.ts")), "compatible-agent.ts");

const catalog = read("cli/src/commands/slash-catalog.ts");
assert(catalog.includes('"auth"'), "/auth in SLASH_COMMANDS");
assert(catalog.includes("Store API keys"), "/auth description");

const slash = read("cli/src/commands/slash.ts");
assert(slash.includes('key === "auth"'), "slash routes /auth");
assert(slash.includes("handleAuth"), "slash loads handleAuth");
assert(slash.includes("compatible"), "backend supports compatible");

const sessionAgent = read("cli/src/sdk/session-agent.ts");
assert(sessionAgent.includes("CompatibleAgent"), "session-agent uses CompatibleAgent");
assert(sessionAgent.includes("resolveOpenRouterCredentials"), "token falls back to credentials file");
assert(sessionAgent.includes("applyCredentialsToRuntime"), "applies credentials at resolve");

const tmp = mkdtempSync(join(tmpdir(), "cursorsi-auth-"));
process.env.CURSORSI_CREDENTIALS_PATH = join(tmp, "credentials.json");

const {
  credentialsPath,
  readCredentials,
  writeCredentials,
  validateUrl,
  maskSecret,
  resolveCompatibleProvider,
  applyCredentialsToRuntime,
  OPENROUTER_DEFAULT_ENDPOINT,
} = await import(
  new URL("../cli/dist/config/credentials.js", import.meta.url).href
);

assert(credentialsPath() === process.env.CURSORSI_CREDENTIALS_PATH, "credentials path override");
assert(validateUrl("https://api.example.com/v1") === true, "valid https url");
assert(validateUrl("http://localhost:8080") === true, "valid http url");
assert(validateUrl("ftp://nope") === false, "reject non-http url");
assert(validateUrl("not-a-url") === false, "reject bare string");

assert(maskSecret("sk-or-v1-abcdefghijklmnop").includes("****"), "mask hides middle");
assert(maskSecret("sk-or-v1-abcdefghijklmnop").endsWith("mnop"), "mask keeps suffix");

const empty = readCredentials();
assert(empty.version === 1, "empty credentials version 1");
assert(!empty.providers.openrouter, "no openrouter by default");

writeCredentials({
  openrouter: {
    key: "sk-or-v1-testkey1234567890",
    models: ["deepseek/deepseek-v4-pro", "openai/gpt-4o"],
  },
});

const afterOr = readCredentials();
assert(afterOr.providers.openrouter?.key === "sk-or-v1-testkey1234567890", "openrouter key stored");
assert(
  afterOr.providers.openrouter?.models?.includes("deepseek/deepseek-v4-pro"),
  "openrouter models stored",
);
assert(
  !afterOr.providers.openrouter?.endpoint ||
    afterOr.providers.openrouter.endpoint === OPENROUTER_DEFAULT_ENDPOINT,
  "openrouter uses default endpoint when omitted",
);

let rejected = false;
try {
  writeCredentials({
    compatible: {
      bad: {
        endpoint: "notaurl",
        key: "k",
        models: ["m"],
      },
    },
  });
} catch {
  rejected = true;
}
assert(rejected, "compatible rejects invalid URL");

writeCredentials({
  cursor: { key: "cursor-key-abcdef" },
  compatible: {
    "my-proxy": {
      endpoint: "https://proxy.example.com/v1/",
      key: "compat-key-xyz",
      models: ["gpt-4o", "claude-sonnet"],
      api: "openai",
    },
  },
});

const file = readCredentials();
assert(file.providers.cursor?.key === "cursor-key-abcdef", "cursor key stored");
const compat = resolveCompatibleProvider("my-proxy");
assert(compat?.endpoint === "https://proxy.example.com/v1", "strips trailing slash");
assert(compat?.models.includes("claude-sonnet"), "compatible models stored");
assert(compat?.api === "openai", "compatible api style");

const st = statSync(process.env.CURSORSI_CREDENTIALS_PATH);
const mode = st.mode & 0o777;
assert(mode === 0o600 || process.platform === "win32", `credentials mode 0600 (got ${mode.toString(8)})`);

delete process.env.OPENROUTER_API_KEY;
delete process.env.CURSOR_API_KEY;
const g = globalThis;
delete g.__cursorsiCk;
delete g.__cursorsiCursorKey;
applyCredentialsToRuntime();
assert(g.__cursorsiCk === "sk-or-v1-testkey1234567890", "apply sets openrouter global");
assert(g.__cursorsiCursorKey === "cursor-key-abcdef", "apply sets cursor global");

const { handleAuth } = await import(
  new URL("../cli/dist/commands/auth.js", import.meta.url).href
);

const lines = [];
const listResult = await handleAuth(
  {
    session: { id: "s", cwd: tmp, modelId: "x", createdAt: "", lines: [], title: "t" },
    pushLine: (l) => lines.push(l),
    setBusy: () => {},
  },
  "list",
);
assert(listResult.ok === true, "/auth list ok");
assert(lines.some((l) => l.includes("openrouter")), "/auth list shows openrouter");
assert(lines.some((l) => l.includes("****")), "/auth list masks keys");
assert(lines.some((l) => l.includes("my-proxy")), "/auth list shows compatible name");

const badUrl = await handleAuth(
  {
    session: { id: "s", cwd: tmp, modelId: "x", createdAt: "", lines: [], title: "t" },
    pushLine: () => {},
    setBusy: () => {},
  },
  "compatible --name x --endpoint not-a-url --key k --models m --api openai",
);
assert(badUrl.ok === false, "/auth compatible rejects bad URL");
assert(
  String(badUrl.message).toLowerCase().includes("invalid"),
  "/auth compatible invalid message",
);

const orResult = await handleAuth(
  {
    session: { id: "s", cwd: tmp, modelId: "x", createdAt: "", lines: [], title: "t" },
    pushLine: () => {},
    setBusy: () => {},
  },
  "openrouter --key sk-or-v1-newkey9999999999 --models a/b,c/d",
);
assert(orResult.ok === true, "/auth openrouter with flags");
const afterFlags = readCredentials();
assert(afterFlags.providers.openrouter?.key === "sk-or-v1-newkey9999999999", "flag key written");
assert(afterFlags.providers.openrouter?.models?.includes("a/b"), "flag models written");

try {
  rmSync(tmp, { recursive: true, force: true });
} catch {
  // ignore
}

if (failures.length) {
  console.error("verify-cursorsi-auth FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("verify-cursorsi-auth: all checks passed");
