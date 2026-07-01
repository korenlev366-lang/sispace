/**
 * Headroom-lite — local compression inspired by chopratejas/headroom transforms.
 * Used when the Headroom proxy is unavailable (no localhost:8787).
 */

export type ContentType = "json" | "logs" | "code" | "text";

export interface HeadroomLiteConfig {
  maxJsonItems: number;
  minJsonItemsToCrush: number;
  maxLogLines: number;
  maxErrors: number;
  maxWarnings: number;
  minCharsToCompress: number;
}

export interface HeadroomLiteResult {
  text: string;
  charsBefore: number;
  charsAfter: number;
  contentType: ContentType;
  transform: string;
  compressed: boolean;
}

const DEFAULT_CONFIG: HeadroomLiteConfig = {
  maxJsonItems: 15,
  minJsonItemsToCrush: 5,
  maxLogLines: 100,
  maxErrors: 10,
  maxWarnings: 5,
  minCharsToCompress: 800,
};

const ERROR_MARKERS = /\b(?:error|fatal|exception|failed|panic|traceback|assert)\b/i;
const WARN_MARKERS = /\b(?:warn|warning|deprecated)\b/i;
const SUMMARY_MARKERS = /\b(?:summary|total|passed|failed|skipped)\b/i;

export function detectContentType(text: string): ContentType {
  const trimmed = text.trim();
  if (!trimmed) return "text";

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("{") && trimmed.endsWith("}"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      /* fall through */
    }
  }

  const lines = trimmed.split(/\r?\n/);
  const logLike = lines.filter((l) =>
    /^(?:\d{4}-\d{2}-\d{2}|\[?\w+\]?|\s*(?:ERROR|WARN|INFO|DEBUG|FATAL))/i.test(l),
  ).length;
  if (lines.length >= 8 && logLike / lines.length > 0.35) return "logs";

  if (/^(?:function |class |import |export |def |pub fn |package )/m.test(trimmed)) {
    return "code";
  }

  return "text";
}

function itemScore(item: unknown, index: number, total: number): number {
  let score = 0;
  const serialized = JSON.stringify(item).toLowerCase();

  if (ERROR_MARKERS.test(serialized)) score += 3;
  if (WARN_MARKERS.test(serialized)) score += 1.5;
  if (typeof item === "object" && item !== null) {
    const obj = item as Record<string, unknown>;
    if (obj.status === "error" || obj.level === "error") score += 2;
    if (obj.error || obj.exception) score += 2;
  }

  const pos = index / Math.max(1, total - 1);
  if (pos <= 0.3) score += 0.5;
  if (pos >= 0.85) score += 0.5;

  return score;
}

function crushJsonArray(items: unknown[], cfg: HeadroomLiteConfig): unknown[] {
  if (items.length < cfg.minJsonItemsToCrush) return items;

  const seen = new Set<string>();
  const scored = items.map((item, index) => ({
    item,
    index,
    score: itemScore(item, index, items.length),
    key: JSON.stringify(item),
  }));

  const unique: typeof scored = [];
  for (const entry of scored) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    unique.push(entry);
  }

  unique.sort((a, b) => b.score - a.score || a.index - b.index);
  const kept = unique.slice(0, cfg.maxJsonItems).sort((a, b) => a.index - b.index);

  const dropped = items.length - kept.length;
  const result = kept.map((k) => k.item);
  if (dropped > 0) {
    result.push({
      _headroom_lite: `<<ccr:${items.length - kept.length}_items_offloaded>>`,
      note: `${dropped} duplicate/low-signal items removed; originals available in session transcript`,
    });
  }
  return result;
}

function compressJson(text: string, cfg: HeadroomLiteConfig): string {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) {
    return JSON.stringify(crushJsonArray(parsed, cfg), null, 2);
  }
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length >= cfg.minJsonItemsToCrush) {
        obj[key] = crushJsonArray(value, cfg);
      }
    }
    return JSON.stringify(obj, null, 2);
  }
  return text;
}

function lineScore(line: string): number {
  let score = 0;
  if (ERROR_MARKERS.test(line)) score += 5;
  if (WARN_MARKERS.test(line)) score += 2;
  if (SUMMARY_MARKERS.test(line)) score += 1.5;
  if (/^\s+at\s+/i.test(line) || /^\s+File "/.test(line)) score += 3;
  if (/^(?:Traceback|Caused by|Stack trace)/i.test(line)) score += 4;
  return score;
}

function normalizeForDedup(line: string): string {
  const parts = line.split(/[:=]/);
  if (parts.length < 2) return line.replace(/\d+/g, "N").toLowerCase();
  const head = parts[0]!.trim().toLowerCase();
  const tail = parts.slice(1).join(":").replace(/\d+/g, "N").toLowerCase();
  return `${head}:${tail}`;
}

function compressLogs(text: string, cfg: HeadroomLiteConfig): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= cfg.maxLogLines) return text;

  const scored = lines.map((content, index) => ({
    content,
    index,
    score: lineScore(content),
    norm: normalizeForDedup(content),
  }));

  const warnSeen = new Set<string>();
  const selected = new Map<number, string>();

  for (const entry of scored) {
    if (entry.score >= 5 && [...selected.keys()].filter((i) => lineScore(lines[i] ?? "") >= 5).length < cfg.maxErrors) {
      selected.set(entry.index, entry.content);
      continue;
    }
    if (entry.score >= 2 && WARN_MARKERS.test(entry.content)) {
      if (warnSeen.has(entry.norm)) continue;
      const warnCount = [...selected.values()].filter((l) => WARN_MARKERS.test(l)).length;
      if (warnCount >= cfg.maxWarnings) continue;
      warnSeen.add(entry.norm);
      selected.set(entry.index, entry.content);
    }
  }

  const head = scored.slice(0, 3);
  const tail = scored.slice(-5);
  for (const entry of [...head, ...tail]) {
    selected.set(entry.index, entry.content);
  }

  for (const entry of scored) {
    if (selected.size >= cfg.maxLogLines) break;
    if (entry.score >= 1) selected.set(entry.index, entry.content);
  }

  const kept = [...selected.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, content]) => content);

  const dropped = lines.length - kept.length;
  if (dropped > 0) {
    kept.push(`[headroom-lite: ${dropped} log lines offloaded — errors/warnings/summaries preserved]`);
  }
  return kept.join("\n");
}

function compressText(text: string): string {
  const lines = text.split(/\r?\n/);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    const norm = line.trim().replace(/\s+/g, " ").toLowerCase();
    if (norm.length > 0 && seen.has(norm)) continue;
    if (norm.length > 0) seen.add(norm);
    kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function compressWithHeadroomLite(
  text: string,
  config: Partial<HeadroomLiteConfig> = {},
): HeadroomLiteResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const charsBefore = text.length;

  if (charsBefore < cfg.minCharsToCompress) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      contentType: "text",
      transform: "passthrough",
      compressed: false,
    };
  }

  const contentType = detectContentType(text);
  let output = text;
  let transform = "passthrough";

  try {
    switch (contentType) {
      case "json":
        output = compressJson(text, cfg);
        transform = "smart_crusher_lite";
        break;
      case "logs":
        output = compressLogs(text, cfg);
        transform = "log_compressor_lite";
        break;
      case "code":
        output = text;
        transform = "code_passthrough";
        break;
      default:
        output = compressText(text);
        transform = "text_dedup";
        break;
    }
  } catch {
    output = compressText(text);
    transform = "text_dedup_fallback";
  }

  return {
    text: output,
    charsBefore,
    charsAfter: output.length,
    contentType,
    transform,
    compressed: output.length < charsBefore,
  };
}
