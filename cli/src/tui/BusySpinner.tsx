import { Box, Text } from "ink";
import { useEffect, useState } from "react";

/** Classic npm / cli-spinners "dots" frames. */
const DOTS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TICK_MS = 80;

export interface BusySpinnerProps {
  /** When false, renders nothing. */
  active: boolean;
  /** Wall-clock ms when the busy period started. */
  startedAt: number;
  /** Short status phrase (e.g. "Working", "Running tools"). */
  label?: string;
  /** Extra right-side hint (e.g. tool count). */
  detail?: string;
}

function formatElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Side-of-prompt activity animation (Qwen / npm-install style braille spinner).
 * Owns its own interval so parent trees do not re-render every tick.
 */
export function BusySpinner({
  active,
  startedAt,
  label = "Working",
  detail,
}: BusySpinnerProps) {
  const [frame, setFrame] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }
    setFrame(0);
    setNow(Date.now());
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % DOTS.length);
      setNow(Date.now());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [active, startedAt]);

  if (!active) {
    return null;
  }

  const elapsed = formatElapsed(startedAt, now);
  const detailPart = detail?.trim() ? ` · ${detail.trim()}` : "";

  return (
    <Box flexDirection="row" marginBottom={0} paddingX={1}>
      <Text color="#d8a657">{DOTS[frame]} </Text>
      <Text color="#e9e5dc">{label}</Text>
      <Text dimColor>
        {" "}
        ({elapsed}
        {detailPart} · Ctrl+C cancel)
      </Text>
    </Box>
  );
}
