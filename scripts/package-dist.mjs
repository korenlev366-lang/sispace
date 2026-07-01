import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

const releaseDir = path.join(root, "src-tauri/target/release");
const bundleDir = path.join(releaseDir, "bundle");
const distDir = path.join(root, "dist");
const cliRoot = path.join(root, "cli");
const cliDist = path.join(cliRoot, "dist");
const cliBin = path.join(cliRoot, "bin", "cursorsi.mjs");

function findFirst(dir, ext) {
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => f.endsWith(ext));
  return hit ? path.join(dir, hit) : null;
}

function copyRecursive(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

fs.mkdirSync(distDir, { recursive: true });

const appImage = findFirst(path.join(bundleDir, "appimage"), ".AppImage");
const deb = findFirst(path.join(bundleDir, "deb"), ".deb");
const binary = path.join(releaseDir, "sispace");

const artifacts = [];

if (appImage) {
  const dest = path.join(distDir, `sispace-${version}.AppImage`);
  fs.copyFileSync(appImage, dest);
  artifacts.push(dest);
}

if (deb) {
  const dest = path.join(distDir, path.basename(deb));
  fs.copyFileSync(deb, dest);
  artifacts.push(dest);
}

if (fs.existsSync(binary)) {
  const dest = path.join(distDir, `sispace-${version}`);
  fs.copyFileSync(binary, dest);
  fs.chmodSync(dest, 0o755);
  artifacts.push(dest);
}

if (fs.existsSync(cliBin) && fs.existsSync(cliDist)) {
  const bundleName = `cursorsi-cli-${version}`;
  const bundleDir = path.join(distDir, bundleName);
  fs.rmSync(bundleDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  copyRecursive(path.join(cliRoot, "bin"), path.join(bundleDir, "bin"));
  copyRecursive(cliDist, path.join(bundleDir, "dist"));
  fs.copyFileSync(path.join(cliRoot, "package.json"), path.join(bundleDir, "package.json"));

  const tarball = path.join(distDir, `${bundleName}.tar.gz`);
  execSync(`tar -czf "${tarball}" -C "${distDir}" "${bundleName}"`, {
    stdio: "inherit",
  });
  artifacts.push(tarball);

  const launcher = `#!/usr/bin/env sh
set -eu
DB="\${SISPACE_DB_PATH:-\$HOME/.local/share/sispace/tasks.db}"
exec node /usr/share/sispace/cursorsi/bin/cursorsi.mjs --db-path "\$DB" "\$@"
`;
  const launcherPath = path.join(distDir, `cursorsi-${version}`);
  fs.writeFileSync(launcherPath, launcher);
  fs.chmodSync(launcherPath, 0o755);
  artifacts.push(launcherPath);
} else {
  console.warn(
    "cursorsi not built — run npm run cursorsi:build before package (need cli/bin and cli/dist)",
  );
}

if (artifacts.length === 0) {
  console.error("No build artifacts found. Run `npm run tauri build` first.");
  process.exit(1);
}

const pkgbuildSrc = path.join(root, "packaging/PKGBUILD");
const pkgbuildDest = path.join(distDir, "PKGBUILD");
if (fs.existsSync(pkgbuildSrc)) {
  let pkgbuild = fs.readFileSync(pkgbuildSrc, "utf8");
  pkgbuild = pkgbuild.replace(/^pkgver=.*/m, `pkgver=${version}`);
  const sourceLines = [];
  if (appImage) {
    sourceLines.push(`"sispace-${version}.AppImage"`);
  } else if (fs.existsSync(path.join(distDir, `sispace-${version}`))) {
    sourceLines.push(`"sispace-${version}"`);
  }
  if (fs.existsSync(path.join(distDir, `cursorsi-${version}`))) {
    sourceLines.push(`"cursorsi-${version}"`);
    sourceLines.push(`"cursorsi-cli-${version}.tar.gz"`);
  }
  if (sourceLines.length > 0) {
    pkgbuild = pkgbuild.replace(/^source=\(.*/m, `source=(${sourceLines.join(" ")})`);
  }
  fs.writeFileSync(pkgbuildDest, pkgbuild);
  artifacts.push(pkgbuildDest);
}

for (const a of artifacts) {
  console.log(`Packaged ${a}`);
}
