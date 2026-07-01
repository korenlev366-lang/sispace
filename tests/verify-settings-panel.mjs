/**
 * Verification script for settings panel surface styles (task t_000e8835).
 * Run: node tests/verify-settings-panel.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const appCssPath = path.join(repoRoot, "src", "App.css");

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function extractRuleBlock(css, selector) {
  const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, "s");
  const match = css.match(re);
  return match ? match[1] : null;
}

function parseBackgroundValue(block) {
  const match = block.match(/background(?:-color)?\s*:\s*([^;]+)/);
  return match ? match[1].trim().toLowerCase() : null;
}

function isOpaqueBackground(value) {
  return value !== null && value !== "transparent" && value !== "none" && value !== "inherit";
}

function assertOpaqueSurface(block, label) {
  const background = parseBackgroundValue(block);
  assert(background !== null, `${label} has no background declaration`);
  assert(
    isOpaqueBackground(background),
    `${label} background is "${background}", expected opaque surface color`,
  );
  assert(
    block.includes("border") && block.includes("border-radius"),
    `${label} missing border or border-radius`,
  );
  assert(block.includes("padding"), `${label} missing padding`);
}

function verifyStatic(css, panelTsx) {
  const settingsBlock = extractRuleBlock(css, ".settings-panel");

  assert(settingsBlock !== null, ".settings-panel rule not found in src/App.css");
  if (settingsBlock) {
    assertOpaqueSurface(settingsBlock, ".settings-panel");
    assert(
      parseBackgroundValue(settingsBlock) === "#1a1d27",
      `.settings-panel background must be #1a1d27, got "${parseBackgroundValue(settingsBlock)}"`,
    );
    assert(
      /width\s*:\s*min\s*\(\s*720px\s*,\s*92vw\s*\)/.test(settingsBlock),
      ".settings-panel must keep width: min(720px, 92vw) (not dialog-card 420px cap)",
    );
  }

  const backdropBlock = extractRuleBlock(css, ".dialog-backdrop");
  assert(backdropBlock !== null, ".dialog-backdrop rule not found in src/App.css");
  if (backdropBlock) {
    const backdropBg = parseBackgroundValue(backdropBlock);
    assert(
      backdropBg !== null && backdropBg.includes("rgba"),
      `.dialog-backdrop must use dimmed rgba backdrop, got "${backdropBg}"`,
    );
  }

  const dialogGroup = css.match(/\.dialog,\s*\n\.dialog-card\s*\{([^}]*)\}/s);
  assert(dialogGroup !== null, ".dialog shared surface rule not found in src/App.css");
  if (dialogGroup) {
    assertOpaqueSurface(dialogGroup[1], ".dialog (shared with .dialog-card)");
  }

  assert(
    panelTsx.includes('className="settings-panel"'),
    "SettingsPanel inner panel must use settings-panel class",
  );
  assert(
    panelTsx.includes('className="dialog-backdrop settings-backdrop"'),
    "SettingsPanel backdrop must use dialog-backdrop (dimmed overlay)",
  );
}

function rgbMatchesHex(rgb, hex) {
  const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return false;
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}` === hex.toLowerCase();
}

async function verifyRuntime(css) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${css}</style></head><body>
        <div class="dialog-backdrop settings-backdrop" id="backdrop">
          <div class="settings-panel" id="panel" role="dialog">Settings</div>
        </div>
      </body></html>`,
      { waitUntil: "domcontentloaded" },
    );

    const panelStyles = await page.locator("#panel").evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        borderWidth: cs.borderTopWidth,
        borderRadius: cs.borderTopLeftRadius,
        paddingTop: cs.paddingTop,
      };
    });

    assert(
      rgbMatchesHex(panelStyles.backgroundColor, "#1a1d27"),
      `[runtime] .settings-panel background is "${panelStyles.backgroundColor}", expected #1a1d27`,
    );
    assert(
      panelStyles.borderWidth !== "0px" && panelStyles.borderRadius !== "0px",
      `[runtime] .settings-panel missing border or border-radius`,
    );
    assert(
      parseFloat(panelStyles.paddingTop) > 0,
      `[runtime] .settings-panel missing padding`,
    );

    const backdropStyles = await page.locator("#backdrop").evaluate((el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, position: cs.position };
    });

    assert(
      backdropStyles.position === "fixed",
      `[runtime] .dialog-backdrop position is "${backdropStyles.position}", expected fixed`,
    );
    assert(
      backdropStyles.backgroundColor.includes("0.55") ||
        backdropStyles.backgroundColor === "rgba(0, 0, 0, 0.55)",
      `[runtime] .dialog-backdrop background is "${backdropStyles.backgroundColor}", expected dimmed rgba`,
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const css = readFileSync(appCssPath, "utf8");
  const panelTsxPath = path.join(repoRoot, "src", "components", "settings", "SettingsPanel.tsx");
  const panelTsx = readFileSync(panelTsxPath, "utf8");

  verifyStatic(css, panelTsx);
  await verifyRuntime(css);

  if (failures.length > 0) {
    console.error("FAIL");
    for (const f of failures) console.error(" -", f);
    process.exit(1);
  }

  console.log("PASS — all verify-settings-panel checks passed (static + runtime)");
}

main().catch((err) => {
  console.error("FAIL — unexpected error:", err);
  process.exit(1);
});
