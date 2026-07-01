/**
 * Static verification for SISpace GTK4 Phase 7 (retire web stack + GTK packaging).
 * Run: node tests/verify-sispace-gtk4-phase7.mjs
 *
 * Auto-block: exits with code 1 if cargo build -p sispace-gtk fails.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

// auto-block: fail fast if gtk-app does not compile
execSync("cargo build -p sispace-gtk 2>&1", { cwd: root, stdio: "pipe" });

function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

const workspace = read("Cargo.toml");
assert(!workspace.includes("src-tauri"), "workspace no longer includes src-tauri");

assert(!existsSync(path.join(root, "src")), "React src/ removed");
assert(!existsSync(path.join(root, "src-tauri")), "Tauri src-tauri/ removed");
assert(!existsSync(path.join(root, "vite.config.ts")), "vite.config.ts removed");
assert(!existsSync(path.join(root, "index.html")), "index.html removed");
assert(!existsSync(path.join(root, "tsconfig.json")), "root tsconfig.json removed");

const pkg = JSON.parse(read("package.json"));
assert(!pkg.dependencies?.react, "react dep removed");
assert(!pkg.dependencies?.["@tauri-apps/api"], "tauri api dep removed");
assert(!pkg.devDependencies?.vite, "vite devDep removed");
assert(!pkg.devDependencies?.["@tauri-apps/cli"], "tauri cli devDep removed");
assert(pkg.scripts["verify:sispace-gtk4-phase7"], "phase7 verify script registered");

const presetsDlg = read("gtk-app/src/ui/presets_dialog.rs");
assert(presetsDlg.includes("Dialog::new") && presetsDlg.includes("adw::"), "AdwDialog presets UI");
assert(presetsDlg.includes("ListBox"), "preset list");
assert(presetsDlg.includes("save_preset_layout"), "save via SQLite");
assert(presetsDlg.includes("apply_preset_for_vte"), "apply spawns VTE panes");

const workspaceSvc = read("sispace-core/src/services/workspace.rs");
assert(workspaceSvc.includes("ensure_default_presets"), "default presets seed");
assert(workspaceSvc.includes("presets::"), "uses db presets module");
assert(workspaceSvc.includes("list_presets"), "list presets API");

const sispaceTab = read("gtk-app/src/ui/sispace/sispace_tab.rs");
assert(sispaceTab.includes("PresetsDialog"), "SISpace tab opens presets");

const pkgbuild = read("packaging/PKGBUILD");
assert(pkgbuild.includes("gtk4"), "PKGBUILD gtk4 dep");
assert(pkgbuild.includes("libadwaita"), "PKGBUILD libadwaita dep");
assert(pkgbuild.includes("vte4"), "PKGBUILD vte4 dep");
assert(!pkgbuild.includes("AppImage"), "PKGBUILD drops AppImage");
assert(pkgbuild.includes("cargo build --release -p sispace-gtk"), "PKGBUILD release gtk build");

const pkgGtk = read("scripts/package-gtk.sh");
assert(pkgGtk.includes("cargo build --release -p sispace-gtk"), "package-gtk release build");
assert(pkgGtk.includes("dist/"), "package-gtk copies to dist");

if (failures.length) {
  console.error("verify-sispace-gtk4-phase7 FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("verify-sispace-gtk4-phase7 OK");
