import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { SDKImage } from "../sdk/types.js";

const execFileAsync = promisify(execFile);

const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const DATA_IMAGE_URL_RE =
  /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/;

export const PLACEHOLDER_DETECT_RE = /\[image #\d+\]/;
const PLACEHOLDER_RE = /\[image #(\d+)\]/g;
const AT_IMAGE_PATH_RE = /@(\/(?:[^\s\n]+\.(?:png|jpe?g|gif|webp)))/gi;
const AT_ONLY_PATH_RE = /^@(\/(?:\S+))$/;

type StoredImage = { data: string; mimeType: string };

const imageStoreBySession = new Map<string, Map<number, StoredImage>>();
const imageCounterBySession = new Map<string, number>();

/** True when clipboard "text" is likely raw image/binary (e.g. wl-paste without --type). */
export function isBinaryClipboardPayload(text: string): boolean {
  if (!text) {
    return false;
  }
  if (text.includes("\0")) {
    return true;
  }
  if (DATA_IMAGE_URL_RE.test(text.trim())) {
    return true;
  }
  const head = text.slice(0, Math.min(text.length, 4096));
  const bytes = Buffer.from(head, "latin1");
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return true;
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return true;
  }
  if (head.startsWith("PNG") && head.includes("IHDR")) {
    return true;
  }
  let control = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
      control++;
    }
  }
  return head.length > 0 && control / head.length > 0.08;
}

function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF87a") {
    return "image/gif";
  }
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function mimeFromPath(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

/** Extract base64 image payload from a file on disk. */
export function extractImageFromBuffer(buf: Buffer): StoredImage | null {
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    return null;
  }
  const mime = detectMimeFromBuffer(buf) ?? "image/png";
  return { mimeType: mime, data: buf.toString("base64") };
}

/** Load an image file into the session store; returns a `[image #N]` placeholder. */
export function ingestImageFromPath(
  sessionId: string,
  filePath: string,
): PasteIngestResult | null {
  const mimeHint = mimeFromPath(filePath);
  if (!mimeHint || !existsSync(filePath)) {
    return null;
  }
  try {
    const buf = readFileSync(filePath);
    const image = extractImageFromBuffer(buf);
    if (!image) {
      return null;
    }
    const resolvedMime = detectMimeFromBuffer(buf) ?? mimeHint;
    const n = storeImage(sessionId, {
      data: image.data,
      mimeType: resolvedMime,
    });
    return { text: imagePlaceholder(n), attachedImageNum: n };
  } catch {
    return null;
  }
}

/** Replace `@/path/to.png` tokens with `[image #N]` placeholders when the file exists. */
function ingestAtPathsInText(sessionId: string, text: string): string {
  return text.replace(AT_IMAGE_PATH_RE, (full, path: string) => {
    const ingested = ingestImageFromPath(sessionId, path);
    return ingested?.text ?? full;
  });
}

/** Extract base64 image payload from pasted blob (data URL, PNG/JPEG magic, or binary). */
export function extractImageFromBlob(blob: string): StoredImage | null {
  const trimmed = blob.trim();
  if (!trimmed) {
    return null;
  }

  const dataUrl = DATA_IMAGE_URL_RE.exec(trimmed);
  if (dataUrl) {
    return {
      mimeType: dataUrl[1],
      data: dataUrl[2].replace(/\s/g, ""),
    };
  }

  const sample = Buffer.from(
    trimmed.slice(0, Math.min(trimmed.length, 64)),
    "latin1",
  );
  const mime = detectMimeFromBuffer(sample);
  if (mime || isBinaryClipboardPayload(trimmed)) {
    const buf = Buffer.from(trimmed, "latin1");
    const resolvedMime = detectMimeFromBuffer(buf) ?? mime ?? "image/png";
    if (buf.length > MAX_IMAGE_BYTES) {
      return null;
    }
    return { mimeType: resolvedMime, data: buf.toString("base64") };
  }

  return null;
}

function nextImageIndex(sessionId: string): number {
  const n = (imageCounterBySession.get(sessionId) ?? 0) + 1;
  imageCounterBySession.set(sessionId, n);
  return n;
}

function storeImage(sessionId: string, image: StoredImage): number {
  const n = nextImageIndex(sessionId);
  let store = imageStoreBySession.get(sessionId);
  if (!store) {
    store = new Map();
    imageStoreBySession.set(sessionId, store);
  }
  store.set(n, image);
  return n;
}

export function imagePlaceholder(index: number): string {
  return `[image #${index}]`;
}

export type PasteIngestResult = {
  text: string;
  attachedImageNum?: number;
};

/** Turn a paste blob into prompt text; binary/images become `[image #N]` placeholders. */
export function ingestPasteBlob(sessionId: string, blob: string): PasteIngestResult {
  const trimmed = blob.trim();
  const atOnly = AT_ONLY_PATH_RE.exec(trimmed);
  if (atOnly) {
    const fromPath = ingestImageFromPath(sessionId, atOnly[1]);
    if (fromPath) {
      return fromPath;
    }
  }

  const image = extractImageFromBlob(blob);
  if (image) {
    const n = storeImage(sessionId, image);
    return { text: imagePlaceholder(n), attachedImageNum: n };
  }
  return { text: normalizePasteText(blob) };
}

/** Substitute `[image #N]` placeholders into SDK message text + images array. */
export function resolveImagePlaceholders(
  sessionId: string,
  text: string,
): { text: string; images: SDKImage[] } {
  const withPaths = ingestAtPathsInText(sessionId, text);
  const store = imageStoreBySession.get(sessionId);
  const images: SDKImage[] = [];
  const seen = new Set<number>();

  for (const match of withPaths.matchAll(PLACEHOLDER_RE)) {
    const n = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(n) || seen.has(n)) {
      continue;
    }
    seen.add(n);
    const img = store?.get(n);
    if (img) {
      images.push({ data: img.data, mimeType: img.mimeType });
    }
  }

  let cleanText = withPaths
    .replace(PLACEHOLDER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText && images.length > 0) {
    cleanText = "(image attached)";
  }

  return { text: cleanText, images };
}

async function tryExec(
  cmd: string,
  args: string[],
  encoding: BufferEncoding | "buffer" = "utf8",
): Promise<string | Buffer | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      maxBuffer: MAX_IMAGE_BYTES,
      encoding,
    });
    if (typeof stdout === "string") {
      return stdout.length > 0 ? stdout : null;
    }
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/** Normalize clipboard text for the prompt (preserve newlines, strip trailing NUL). */
export function normalizePasteText(text: string): string {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\0/g, "")
    .replace(/\r/g, "\n");
  if (isBinaryClipboardPayload(normalized)) {
    return "";
  }
  return normalized;
}

/** Strip binary paste noise before sending a user turn to the agent. */
export function sanitizePromptInput(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("@") && !trimmed.includes("\0")) {
    return trimmed;
  }
  if (PLACEHOLDER_DETECT_RE.test(trimmed)) {
    return trimmed;
  }
  if (isBinaryClipboardPayload(trimmed)) {
    return "";
  }
  return normalizePasteText(trimmed);
}

export async function readClipboardText(): Promise<string | null> {
  if (process.env.WAYLAND_DISPLAY) {
    const wl = await tryExec("wl-paste", ["--no-newline"]);
    if (typeof wl === "string" && wl) {
      return wl;
    }
  }
  const xclip = await tryExec("xclip", [
    "-selection",
    "clipboard",
    "-o",
  ]);
  if (typeof xclip === "string" && xclip) {
    return xclip;
  }
  const pb = await tryExec("pbpaste", []);
  if (typeof pb === "string" && pb) {
    return pb;
  }
  return null;
}

export async function readClipboardImagePath(): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "cursorsi-paste-"));
  const path = join(dir, "clipboard.png");

  if (process.env.WAYLAND_DISPLAY) {
    const png = await tryExec("wl-paste", ["--type", "image/png"], "buffer");
    if (png instanceof Buffer && png.length > 0 && png.length <= MAX_IMAGE_BYTES) {
      await writeFile(path, png);
      return path;
    }
  }

  const xclip = await tryExec(
    "xclip",
    ["-selection", "clipboard", "-t", "image/png", "-o"],
    "buffer",
  );
  if (
    xclip instanceof Buffer &&
    xclip.length > 0 &&
    xclip.length <= MAX_IMAGE_BYTES
  ) {
    await writeFile(path, xclip);
    return path;
  }

  return null;
}

/** Text for prompt input, or image placeholder / `@/path` when the clipboard holds an image. */
export async function readClipboardForPrompt(
  sessionId: string,
): Promise<PasteIngestResult | null> {
  const text = await readClipboardText();
  if (text?.trim()) {
    const ingested = ingestPasteBlob(sessionId, text);
    if (ingested.text) {
      if (ingested.text.length > MAX_TEXT_BYTES) {
        return {
          text: `${ingested.text.slice(0, MAX_TEXT_BYTES)}…`,
          attachedImageNum: ingested.attachedImageNum,
        };
      }
      return ingested;
    }
  }
  const imagePath = await readClipboardImagePath();
  if (imagePath) {
    const fromPath = ingestImageFromPath(sessionId, imagePath);
    if (fromPath) {
      return fromPath;
    }
    return { text: `@${imagePath}` };
  }
  return null;
}

export function isPasteShortcut(
  char: string,
  key: { ctrl: boolean },
): boolean {
  return key.ctrl && char === "v";
}

async function tryExecWithInput(
  cmd: string,
  args: string[],
  input: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ok);
    };

    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    const stdin = child.stdin;
    if (!stdin) {
      finish(false);
      return;
    }

    child.on("error", () => finish(false));
    stdin.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));

    try {
      stdin.write(input);
      stdin.end();
    } catch {
      finish(false);
    }
  });
}

function isWaylandSession(): boolean {
  return Boolean(
    process.env.WAYLAND_DISPLAY ||
      (process.env.XDG_RUNTIME_DIR && !process.env.DISPLAY),
  );
}

/** Write plain text to the system clipboard (Wayland, X11, or macOS). */
export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }
  if (isWaylandSession()) {
    if (await tryExecWithInput("wl-copy", ["--no-newline"], text)) {
      return true;
    }
    if (await tryExecWithInput("wl-copy", [], text)) {
      return true;
    }
  }
  if (await tryExecWithInput("xclip", ["-selection", "clipboard"], text)) {
    return true;
  }
  if (await tryExecWithInput("pbcopy", [], text)) {
    return true;
  }
  return false;
}

/** Kitty / xterm modifyOtherKeys style Ctrl+Shift+C (not plain \\x03). */
export function isShiftCtrlCRaw(chunk: string): boolean {
  return (
    /\x1b\[(?:99|67);(?:5|6)u/.test(chunk) ||
    /\x1b\[27;(?:5|6);(?:99|67)~/.test(chunk)
  );
}

const SHIFT_CTRL_C_RAW_BUF_MAX = 48;
let shiftCtrlCRawBuf = "";

/** Detect Shift+Ctrl+C escape bytes even when PTY splits them across reads. */
export function consumeShiftCtrlCRawChunk(
  chunk: string | Buffer,
): boolean {
  const piece =
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
  shiftCtrlCRawBuf = (shiftCtrlCRawBuf + piece).slice(-SHIFT_CTRL_C_RAW_BUF_MAX);
  const matched =
    isShiftCtrlCRaw(piece) || isShiftCtrlCRaw(shiftCtrlCRawBuf);
  if (matched) {
    shiftCtrlCRawBuf = "";
  }
  return matched;
}

export function resetShiftCtrlCRawBuffer(): void {
  shiftCtrlCRawBuf = "";
}

export function isCopyShortcut(
  char: string,
  key: { ctrl: boolean; shift: boolean },
): boolean {
  if (!key.ctrl) {
    return false;
  }
  const letter = char.toLowerCase();
  if (letter !== "c") {
    return false;
  }
  // Terminals often drop the shift flag when ctrl is held; uppercase C still
  // indicates Shift was pressed.
  return key.shift || char === "C";
}

export function isQuitShortcut(
  char: string,
  key: { ctrl: boolean; shift: boolean },
): boolean {
  return key.ctrl && char === "c" && !isCopyShortcut(char, key);
}
