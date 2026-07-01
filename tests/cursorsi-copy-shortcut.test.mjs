/**
 * CursorSI copy vs quit keyboard shortcuts.
 * Run: node --test tests/cursorsi-copy-shortcut.test.mjs
 * Requires: cd cli && npm run build
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumeShiftCtrlCRawChunk,
  isCopyShortcut,
  isQuitShortcut,
  isShiftCtrlCRaw,
  resetShiftCtrlCRawBuffer,
} from "../cli/dist/tui/paste.js";

describe("copy vs quit shortcuts", () => {
  it("isCopyShortcut accepts ctrl+shift+c and ctrl+uppercase-C", () => {
    assert.equal(isCopyShortcut("c", { ctrl: true, shift: true }), true);
    assert.equal(isCopyShortcut("C", { ctrl: true, shift: false }), true);
  });

  it("isCopyShortcut rejects plain ctrl+c", () => {
    assert.equal(isCopyShortcut("c", { ctrl: true, shift: false }), false);
  });

  it("isQuitShortcut quits on ctrl+c but not shift+ctrl+c", () => {
    assert.equal(isQuitShortcut("c", { ctrl: true, shift: false }), true);
    assert.equal(isQuitShortcut("c", { ctrl: true, shift: true }), false);
    assert.equal(isQuitShortcut("C", { ctrl: true, shift: false }), false);
  });

  it("isShiftCtrlCRaw detects kitty/xterm enhanced sequences", () => {
    assert.equal(isShiftCtrlCRaw("\x1b[99;5u"), true);
    assert.equal(isShiftCtrlCRaw("\x1b[27;6;99~"), true);
    assert.equal(isShiftCtrlCRaw("\x03"), false);
  });

  it("consumeShiftCtrlCRawChunk detects sequences split across PTY reads", () => {
    resetShiftCtrlCRawBuffer();
    const seq = "\x1b[27;6;99~";
    assert.equal(consumeShiftCtrlCRawChunk(seq.slice(0, 8)), false);
    assert.equal(consumeShiftCtrlCRawChunk(seq.slice(8)), true);
    resetShiftCtrlCRawBuffer();
  });

  it("consumeShiftCtrlCRawChunk does not re-fire after copy on later keys", () => {
    resetShiftCtrlCRawBuffer();
    assert.equal(consumeShiftCtrlCRawChunk("\x1b[27;6;99~"), true);
    assert.equal(consumeShiftCtrlCRawChunk("\x7f"), false);
    assert.equal(consumeShiftCtrlCRawChunk("a"), false);
    resetShiftCtrlCRawBuffer();
  });
});
