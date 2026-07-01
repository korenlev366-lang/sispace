export interface CliOptions {
  voice: boolean;
  notifyTopic?: string;
  /** Phase 1a: skip auto-reflection on session end when true. */
  noReflect: boolean;
  /** Phase 1b: resume task id from --resume <task-id>. */
  resumeTaskId?: string;
  /** Optional override for shared kanban DB file. */
  dbPath?: string;
  /** Phase 1d: attach handoff session blob on TUI start. */
  handoffAttachId?: string;
  /** Phase 0e: minimal TUI for SISpace V2 embedded panes. */
  paneMode: boolean;
  /** Phase 0e: Unix socket path for NDJSON pane events. */
  eventSocket?: string;
  /** Phase 5: swarm role label for pane IPC (coordinator, worker, verifier, synthesizer). */
  swarmRole?: string;
}

type GlobalCli = { __cursorsiCliOpts?: CliOptions };
type GlobalDb = { __cursorsiDbPath?: string };

export function parseCliArgs(argv: string[]): CliOptions {
  let voice = false;
  let notifyTopic: string | undefined;
  let noReflect = false;
  let resumeTaskId: string | undefined;
  let dbPath: string | undefined;
  let handoffAttachId: string | undefined;
  let paneMode = false;
  let eventSocket: string | undefined;
  let swarmRole: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--voice") {
      voice = true;
      continue;
    }
    if (arg === "--no-reflect") {
      noReflect = true;
      continue;
    }
    if (arg === "--resume" && argv[i + 1]) {
      resumeTaskId = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === "--db-path" && argv[i + 1]) {
      dbPath = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === "--notify-topic" && argv[i + 1]) {
      notifyTopic = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === "--handoff-attach" && argv[i + 1]) {
      handoffAttachId = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === "--pane-mode") {
      paneMode = true;
      continue;
    }
    if (arg === "--event-socket" && argv[i + 1]) {
      eventSocket = argv[i + 1].trim();
      i += 1;
      continue;
    }
    if (arg === "--swarm-role" && argv[i + 1]) {
      swarmRole = argv[i + 1].trim();
      i += 1;
      continue;
    }
  }

  return {
    voice,
    notifyTopic,
    noReflect,
    resumeTaskId,
    dbPath,
    handoffAttachId,
    paneMode,
    eventSocket,
    swarmRole,
  };
}

export function getCliOptions(): CliOptions {
  return (
    (globalThis as GlobalCli).__cursorsiCliOpts ?? {
      voice: false,
      noReflect: false,
      paneMode: false,
    }
  );
}

export function setCliOptions(opts: CliOptions): void {
  (globalThis as GlobalCli).__cursorsiCliOpts = opts;
  if (opts.dbPath?.trim()) {
    (globalThis as GlobalDb).__cursorsiDbPath = opts.dbPath.trim();
  }
}
