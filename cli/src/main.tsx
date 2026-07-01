import { render } from "ink";
import { logModelRemaps, validateSessionStateModels } from "./models/session-models.js";
import { loadUserSettings } from "./config/user-settings.js";
import { Orchestrator } from "./tui/Orchestrator.js";
import { initCliRuntime } from "./runtime/init.js";
import { getCliOptions } from "./runtime/cli-options.js";
import { installCrashHandlers, logFatalError } from "./runtime/crash-log.js";
import { createInitialSessionState } from "./session/store.js";
import { tokenFromEnv } from "./sdk/session-agent.js";
import { runPaneMode } from "./pane/mode.js";
import { VOICE_STUB_MESSAGE } from "./voice/stub.js";

installCrashHandlers();

const argv = process.argv.slice(2);
const cwd = process.cwd();

let initialSessionState = await initCliRuntime(argv, cwd);

// Load persistent user settings at startup
const userSettings = loadUserSettings();
const debug = process.env.CURSORSI_DEBUG === "1" || process.env.CURSORSI_DEBUG === "true";
if (debug) {
  process.stderr.write(
    `[cursorsi:user-settings] backend=${userSettings.backend}` +
      `${userSettings.defaultModel ? `, defaultModel=${userSettings.defaultModel}` : ", default from catalog"}` +
      `\n`,
  );
}

const credential = tokenFromEnv() ?? "";
if (credential && userSettings.backend === "openrouter") {
  const base = initialSessionState ?? createInitialSessionState(cwd);
  const { state, remapped } = await validateSessionStateModels(base, credential);
  logModelRemaps(remapped);
  initialSessionState = state;
}
const cliOpts = getCliOptions();

if (cliOpts.paneMode) {
  await runPaneMode(cliOpts, initialSessionState, cwd);
} else {
  const ink = render(
    <Orchestrator
      initialSessionState={initialSessionState}
      voiceEnabled={cliOpts.voice}
      voiceStubMessage={cliOpts.voice ? VOICE_STUB_MESSAGE : undefined}
      notifyTopicOverride={cliOpts.notifyTopic}
    />,
    { exitOnCtrlC: false },
  );
  void ink.waitUntilExit().catch((err) => {
    logFatalError("ink-waitUntilExit", err);
    process.exit(1);
  });
}
