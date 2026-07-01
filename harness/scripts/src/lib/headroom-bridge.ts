/**
 * Headroom bridge — uses headroom-ai npm SDK against a running proxy,
 * with headroom-lite fallback when the proxy is unavailable.
 */

import { compressWithHeadroomLite } from "./headroom-lite.js";

export interface HeadroomBridgeConfig {
  enabled: boolean;
  proxyUrl: string;
  fallbackLite: boolean;
  timeoutMs: number;
  model: string;
  /** Conservative ratio for harness prompts (higher = keep more) */
  targetKeepRatio: number;
}

export interface HeadroomBridgeResult {
  text: string;
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  backend: "headroom-proxy" | "headroom-lite" | "passthrough";
  transform: string;
  compressed: boolean;
}

const DEFAULT_CONFIG: HeadroomBridgeConfig = {
  enabled: true,
  proxyUrl: process.env.HEADROOM_PROXY_URL ?? "http://localhost:8787",
  fallbackLite: true,
  timeoutMs: 8_000,
  model: "gpt-4o",
  targetKeepRatio: 0.55,
};

let proxyHealthCache: { ok: boolean; checkedAt: number } | null = null;
const HEALTH_TTL_MS = 30_000;

async function proxyHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const now = Date.now();
  if (proxyHealthCache && now - proxyHealthCache.checkedAt < HEALTH_TTL_MS) {
    return proxyHealthCache.ok;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    });
    const ok = res.ok;
    proxyHealthCache = { ok, checkedAt: now };
    return ok;
  } catch {
    proxyHealthCache = { ok: false, checkedAt: now };
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function extractUserContent(messages: unknown[]): string {
  const last = messages[messages.length - 1] as { content?: unknown } | undefined;
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

export async function compressWithHeadroom(
  text: string,
  config: Partial<HeadroomBridgeConfig> = {},
): Promise<HeadroomBridgeResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const charsBefore = text.length;
  const tokensBefore = Math.ceil(charsBefore / 4);

  if (!cfg.enabled || !text.trim()) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      backend: "passthrough",
      transform: "disabled",
      compressed: false,
    };
  }

  const proxyUp = await proxyHealthy(cfg.proxyUrl, Math.min(cfg.timeoutMs, 3_000));
  if (proxyUp) {
    try {
      const { compress } = await import("headroom-ai");
      const messages = [{ role: "user" as const, content: text }];
      const result = await compress(messages, {
        baseUrl: cfg.proxyUrl,
        model: cfg.model,
        timeout: cfg.timeoutMs,
        fallback: false,
        tokenBudget: Math.ceil(tokensBefore * cfg.targetKeepRatio),
      });

      const compressedText = extractUserContent(result.messages) || text;
      const tokensAfter = result.tokensAfter || Math.ceil(compressedText.length / 4);
      const actuallySmaller = compressedText.length < charsBefore;

      if (!actuallySmaller) {
        return {
          text,
          charsBefore,
          charsAfter: charsBefore,
          tokensBefore,
          tokensAfter: tokensBefore,
          tokensSaved: 0,
          backend: "headroom-proxy",
          transform: "no_savings_passthrough",
          compressed: false,
        };
      }

      return {
        text: compressedText,
        charsBefore,
        charsAfter: compressedText.length,
        tokensBefore: result.tokensBefore || tokensBefore,
        tokensAfter,
        tokensSaved: result.tokensSaved || Math.max(0, tokensBefore - tokensAfter),
        backend: "headroom-proxy",
        transform: result.transformsApplied?.join(",") || "headroom",
        compressed: result.compressed && actuallySmaller,
      };
    } catch {
      /* fall through to lite */
    }
  }

  if (cfg.fallbackLite) {
    const lite = compressWithHeadroomLite(text);
    const tokensAfter = Math.ceil(lite.charsAfter / 4);
    return {
      text: lite.text,
      charsBefore,
      charsAfter: lite.charsAfter,
      tokensBefore,
      tokensAfter,
      tokensSaved: Math.max(0, tokensBefore - tokensAfter),
      backend: "headroom-lite",
      transform: lite.transform,
      compressed: lite.compressed,
    };
  }

  return {
    text,
    charsBefore,
    charsAfter: charsBefore,
    tokensBefore,
    tokensAfter: tokensBefore,
    tokensSaved: 0,
    backend: "passthrough",
    transform: "proxy_unavailable",
    compressed: false,
  };
}

export function resetHeadroomHealthCache(): void {
  proxyHealthCache = null;
}
