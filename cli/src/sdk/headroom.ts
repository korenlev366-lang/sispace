/**
 * Headroom compression for CursorSI CLI.
 * Calls the running headroom proxy directly via HTTP.
 * No npm dependency needed — uses native fetch().
 */

const DEFAULT_PROXY_URL = "http://localhost:8787";
const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TARGET_KEEP_RATIO = 0.55;
const MIN_CHARS_TO_COMPRESS = 800;

export interface HeadroomConfig {
  enabled: boolean;
  proxyUrl: string;
  timeoutMs: number;
  model: string;
  targetKeepRatio: number;
  minCharsToCompress: number;
}

export interface HeadroomResult {
  text: string;
  charsBefore: number;
  charsAfter: number;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  transforms: string[];
  compressed: boolean;
}

export function loadHeadroomConfig(): HeadroomConfig {
  return {
    enabled: process.env.HEADROOM_ENABLED !== "false",
    proxyUrl: process.env.HEADROOM_PROXY_URL ?? DEFAULT_PROXY_URL,
    timeoutMs: Number(process.env.HEADROOM_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    model: process.env.HEADROOM_MODEL ?? DEFAULT_MODEL,
    targetKeepRatio: Number(process.env.HEADROOM_KEEP_RATIO) || DEFAULT_TARGET_KEEP_RATIO,
    minCharsToCompress: Number(process.env.HEADROOM_MIN_CHARS) || MIN_CHARS_TO_COMPRESS,
  };
}

async function proxyHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compress text through the headroom proxy.
 * Returns the original text unchanged if the proxy is down or compression yields no savings.
 */
export async function compressWithHeadroom(
  text: string,
  config?: Partial<HeadroomConfig>,
): Promise<HeadroomResult> {
  const cfg = { ...loadHeadroomConfig(), ...config };
  const charsBefore = text.length;
  const tokensBefore = Math.ceil(charsBefore / 4);

  if (!cfg.enabled || !text.trim() || charsBefore < cfg.minCharsToCompress) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      transforms: [],
      compressed: false,
    };
  }

  const up = await proxyHealthy(cfg.proxyUrl, 3_000);
  if (!up) {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      transforms: [],
      compressed: false,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const tokenBudget = Math.ceil(tokensBefore * cfg.targetKeepRatio);
    const res = await fetch(`${cfg.proxyUrl.replace(/\/$/, "")}/v1/compress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: text }],
        model: cfg.model,
        token_budget: tokenBudget,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        text,
        charsBefore,
        charsAfter: charsBefore,
        tokensBefore,
        tokensAfter: tokensBefore,
        tokensSaved: 0,
        transforms: [],
        compressed: false,
      };
    }

    const data = (await res.json()) as {
      messages?: Array<{ content?: string }>;
      tokens_before?: number;
      tokens_after?: number;
      tokens_saved?: number;
      transforms_applied?: string[];
    };

    const compressedContent = data.messages?.[0]?.content ?? "";
    const charsAfter = compressedContent.length;
    const tokensAfter = data.tokens_after ?? Math.ceil(charsAfter / 4);

    if (!compressedContent || charsAfter >= charsBefore) {
      return {
        text,
        charsBefore,
        charsAfter: charsBefore,
        tokensBefore: data.tokens_before ?? tokensBefore,
        tokensAfter: tokensBefore,
        tokensSaved: 0,
        transforms: data.transforms_applied ?? [],
        compressed: false,
      };
    }

    return {
      text: compressedContent,
      charsBefore,
      charsAfter,
      tokensBefore: data.tokens_before ?? tokensBefore,
      tokensAfter,
      tokensSaved: data.tokens_saved ?? Math.max(0, tokensBefore - tokensAfter),
      transforms: data.transforms_applied ?? [],
      compressed: true,
    };
  } catch {
    return {
      text,
      charsBefore,
      charsAfter: charsBefore,
      tokensBefore,
      tokensAfter: tokensBefore,
      tokensSaved: 0,
      transforms: [],
      compressed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}