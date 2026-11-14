const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async function run() {
  const extension = vscode.extensions.getExtension("bemulima.codechuman-vscode");
  assert.ok(extension, "Codechuman extension was not installed into the test host");
  await extension.activate();
  assert.equal(extension.isActive, true, "Codechuman extension did not activate");

  const actual = new Set(await vscode.commands.getCommands(true));
  for (const command of [
    "codechuman.open",
    "codechuman.refresh",
    "codechuman.signIn",
    "codechuman.signOut",
    "codechuman.checkoutRemote",
    "codechuman.syncActive",
    "codechuman.autoSyncEnable",
    "codechuman.autoSyncDisable",
  ]) {
    assert.ok(actual.has(command), "Missing Codechuman command: " + command);
  }

  // Resolves the real packaged React webview. No Auth, external AI, CLI
  // checkout or Sandbox calls are needed to verify this local smoke.
  await vscode.commands.executeCommand("codechuman.open");
};
