/**
 * Verification script for public/test.html (task t_4673d223).
 * Run: node tests/verify-test-html.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const testHtmlPath = path.join(repoRoot, "public", "test.html");
const testHtmlUrl = `file://${testHtmlPath}`;

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function verifyPage(page, label) {
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(testHtmlUrl, { waitUntil: "domcontentloaded" });

  const button = page.locator("#test-btn");
  await button.waitFor({ state: "visible" });

  const buttonText = (await button.textContent())?.trim();
  assert(buttonText === "test", `[${label}] button text is "${buttonText}", expected "test"`);

  const styles = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      paddingTop: cs.paddingTop,
      paddingLeft: cs.paddingLeft,
    };
  });
  const fontPx = parseFloat(styles.fontSize);
  assert(fontPx >= 32, `[${label}] button font-size ${styles.fontSize} is not large (expected >= 32px)`);

  const bodyLayout = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { display: cs.display, alignItems: cs.alignItems, justifyContent: cs.justifyContent };
  });
  assert(
    bodyLayout.display === "flex" &&
      bodyLayout.alignItems === "center" &&
      bodyLayout.justifyContent === "center",
    `[${label}] body is not flex-centered`,
  );

  const audioResult = await page.evaluate(async () => {
    const btn = document.getElementById("test-btn");
    if (!btn) return { ok: false, reason: "button missing" };

    let contextCreated = false;
    let oscillatorStarted = false;

    const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!OriginalAudioContext) return { ok: false, reason: "Web Audio unavailable" };

    class TrackingAudioContext extends OriginalAudioContext {
      constructor(...args) {
        super(...args);
        contextCreated = true;
      }
      createOscillator() {
        oscillatorStarted = true;
        return super.createOscillator();
      }
    }

    window.AudioContext = TrackingAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = TrackingAudioContext;

    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    btn.click();
    await new Promise((r) => setTimeout(r, 50));
    btn.click();
    await new Promise((r) => setTimeout(r, 100));

    return { ok: contextCreated && oscillatorStarted, contextCreated, oscillatorStarted };
  });

  assert(audioResult.ok, `[${label}] Web Audio ding not triggered: ${JSON.stringify(audioResult)}`);
  assert(consoleErrors.length === 0, `[${label}] console errors: ${consoleErrors.join("; ")}`);
}

async function main() {
  assert(readFileSync(testHtmlPath, "utf8").includes('id="test-btn"'), "public/test.html missing test button");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await verifyPage(page, "file://");
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error("FAIL");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }

  console.log("PASS — all verify-test-html checks passed");
}

main().catch((err) => {
  console.error("FAIL — unexpected error:", err);
  process.exit(1);
});
