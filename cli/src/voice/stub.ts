/** Phase 0d placeholder — whisper push-to-talk ships in a later phase. */

export const VOICE_STUB_MESSAGE =
  "Voice input not yet implemented (--voice is a stub; whisper integration pending).";

export function isVoiceEnabled(): boolean {
  return Boolean(
    (globalThis as { __cursorsiCliOpts?: { voice?: boolean } }).__cursorsiCliOpts
      ?.voice,
  );
}
