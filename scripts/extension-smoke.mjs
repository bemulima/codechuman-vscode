import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (!existsSync(join(root, "dist", "extension.js")) ||
    !existsSync(join(root, "dist", "webview", "index.html"))) {
  throw new Error("Build Codechuman first: npm run build");
}
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.error("No GUI display. On headless Linux install Xvfb and run: xvfb-run -a npm run test:extension");
  process.exit(2);
}

const opts = {
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "test", "extension-host", "smoke.cjs"),
  launchArgs: ["--disable-workspace-trust", "--skip-welcome", "--skip-release-notes"],
};
if (process.env.CODECHUMAN_VSCODE_BIN) {
  opts.vscodeExecutablePath = process.env.CODECHUMAN_VSCODE_BIN;
} else {
  opts.version = process.env.CODECHUMAN_VSCODE_VERSION || "stable";
}

try {
  await runTests(opts);
} catch (error) {
  console.error("Codechuman VS Code extension-host smoke failed:", error?.message || String(error));
  process.exitCode = 1;
}
