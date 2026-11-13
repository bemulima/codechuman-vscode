import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ClientRequest, LocalCheckout, LocalDiagnostic, ServerMessage } from "./shared/protocol";
import { isClientRequest } from "./shared/protocol";
import { listLocalExamples, readLessonMaterial } from "./shared/materials";
import { AuthSession } from "./shared/auth";
import { SandboxHttpSync } from "./shared/sandbox";
import { checkoutFileForSync } from "./shared/workspace";
import { DebouncedSandboxQueue } from "./shared/auto-sync";

type SensitiveSetting = "apiBaseUrl" | "cliPath" | "workspaceRoot";

function trustedSetting(key: SensitiveSetting, fallback: string): string {
  const config = vscode.workspace.getConfiguration("codechuman");
  const details = config.inspect<string>(key);
  // Defense in depth: never let task-scoped .vscode/settings.json redirect
  // credentials to another server or change the binary we execute.
  if (details?.workspaceValue !== undefined || details?.workspaceFolderValue !== undefined) {
    throw new Error(`Настройка codechuman.${key} разрешена только на уровне пользователя.`);
  }
  return config.get<string>(key, fallback);
}

function apiBaseURL(): string {
  return trustedSetting("apiBaseUrl", "").trim();
}

function localRoot(): string {
  const setting = trustedSetting("workspaceRoot", "~/.codechuman");
  return path.resolve(setting === "~" ? os.homedir() : setting.startsWith("~/") ? path.join(os.homedir(), setting.slice(2)) : setting);
}

function checkedDirectory(requested: string): string {
  const root = realpathSync(localRoot());
  const candidate = realpathSync(requested);
  const relative = path.relative(root, candidate);
  if (relative === "" || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Выберите существующий локальный урок внутри Codechuman workspace.");
  }
  return candidate;
}

function cli(args: string[], options: { stdin?: string; timeoutMs?: number } = {}): Promise<unknown> {
  const binary = trustedSetting("cliPath", "codechuman");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    // Public CLI checks have their own 20s deadline; allow enough time for
    // the child to report the real result before killing a stuck process.
    const timeout = setTimeout(() => child.kill(), options.timeoutMs ?? 30000);
    // Credentials are sent to the CLI only over a pipe. Never put a bearer in
    // a command argument or a shell environment variable.
    child.stdin.on("error", () => { /* EPIPE is reported via child exit. */ });
    child.stdin.end(options.stdin ?? "");
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8192) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || stdout.length > 1024 * 1024) {
        reject(new Error(`Codechuman CLI завершился с кодом ${code ?? "?"}. ${stderr.slice(0,500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Некорректный JSON-ответ Codechuman CLI."));
      }
    });
  });
}

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly autoSyncTasks = new Map<string, DebouncedSandboxQueue>();
  private readonly acknowledgedFences = new Map<string, { origin: string; epoch: number }>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private auth(): AuthSession {
    const origin = apiBaseURL();
    let session = this.authSessions.get(origin);
    if (!session) {
      session = new AuthSession(origin, this.context.secrets);
      this.authSessions.set(origin, session);
    }
    return session;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((value: unknown) => {
      if (!isClientRequest(value)) {
        this.send({ type: "error", message: "Неподдерживаемая команда." });
        return;
      }
      void this.handle(value);
    });
  }

  async refresh(): Promise<void> {
    await this.handle({ type: "doctor" });
    await this.handle({ type: "list" });
    await this.handle({ type: "auth-status" });
    await this.handle({ type: "auto-sync-status" });
  }

  run(message: ClientRequest): Promise<void> {
    return this.handle(message);
  }

  private send(message: ServerMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private reportAutoSyncState(): void {
    this.send({ type: "auto-sync", enabled: this.autoSyncTasks.size > 0,
      activeTasks: this.autoSyncTasks.size,
      halted: [...this.autoSyncTasks.values()].some((queue) => queue.isHalted) });
  }

  private disableAutoSync(): void {
    for (const queue of this.autoSyncTasks.values()) queue.disable();
    this.autoSyncTasks.clear();
    this.reportAutoSyncState();
  }

  onDocumentChanged(document: vscode.TextDocument): void {
    if (!this.autoSyncTasks.size || document.uri.scheme !== "file") return;
    try {
      const binding = checkoutFileForSync(localRoot(), document.uri.fsPath);
      this.autoSyncTasks.get(binding.sandboxId)?.schedule(binding.relativePath, document.getText());
    } catch {
      // Ordinary documents outside an enabled, cached lesson do not sync.
    }
  }

  private async handle(message: ClientRequest): Promise<void> {
    try {
      switch (message.type) {
        case "auth-status": {
          if (!apiBaseURL()) {
            this.send({ type: "auth", configured: false, connected: false });
            break;
          }
          this.send({ type: "auth", configured: true, connected: await this.auth().isSignedIn() });
          break;
        }
        case "sign-in": {
          if (!apiBaseURL()) throw new Error("Настрой HTTPS адрес в Codechuman: API Base URL.");
          const email = await vscode.window.showInputBox({
            title: "Войти в Codechuman", prompt: "Email аккаунта", ignoreFocusOut: true,
          });
          if (email === undefined) break;
          const password = await vscode.window.showInputBox({
            title: "Войти в Codechuman", prompt: "Пароль аккаунта (не сохраняется)",
            password: true, ignoreFocusOut: true,
          });
          if (password === undefined) break;
          await this.auth().signIn(email, password);
          this.send({ type: "auth", configured: true, connected: true });
          void vscode.window.showInformationMessage("Аккаунт Codechuman подключён.");
          break;
        }
        case "sign-out": {
          this.disableAutoSync();
          this.acknowledgedFences.clear();
          if (apiBaseURL()) await this.auth().signOut();
          this.send({ type: "auth", configured: !!apiBaseURL(), connected: false });
          break;
        }
        case "checkout-remote": {
          if (!apiBaseURL()) throw new Error("Настрой HTTPS адрес Codechuman Gateway.");
          const token = await this.auth().getAccessToken();
          if (!token) throw new Error("Сначала войди в аккаунт Codechuman.");
          const taskID = await vscode.window.showInputBox({
            title: "Скачать Codechuman TaskInstance", prompt: "UUID уже запущенной задачи",
            ignoreFocusOut: true,
            validateInput: (value) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)
              ? null : "Нужен UUID TaskInstance.",
          });
          if (taskID === undefined) break;
          await cli(["checkout-remote", "--api-base", apiBaseURL(), "--task-instance", taskID,
            "--root", localRoot(), "--token-stdin"], { stdin: token, timeoutMs: 150000 });
          void vscode.window.showInformationMessage("Задание Codechuman загружено в локальный каталог.");
          await this.handle({ type: "list" });
          break;
        }
        case "sync-active": {
          if (!apiBaseURL()) throw new Error("Настрой HTTPS адрес Codechuman Gateway.");
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.uri.scheme !== "file") {
            throw new Error("Открой исходный файл скачанного задания в редакторе VS Code.");
          }
          const binding = checkoutFileForSync(localRoot(), editor.document.uri.fsPath);
          if (this.autoSyncTasks.has(binding.sandboxId)) {
            throw new Error("Сначала выключи автосинхронизацию для ручной отправки этого задания.");
          }
          const token = await this.auth().getAccessToken();
          if (!token) throw new Error("Сначала войди в аккаунт Codechuman.");
          // Explicit action: sends the editor's current buffer, including unsaved
          // changes. No file watching, implicit Git commit, or hidden AI call.
          const result = await new SandboxHttpSync(apiBaseURL()).syncFile({
            sandboxId: binding.sandboxId,
            relativePath: binding.relativePath,
            content: editor.document.getText(),
            token,
          });
          if (result.fenceEpoch !== undefined) {
            this.acknowledgedFences.set(binding.sandboxId, { origin: apiBaseURL(), epoch: result.fenceEpoch });
          } else {
            this.acknowledgedFences.delete(binding.sandboxId);
          }
          this.send({ type: "sync", revision: result.workspaceRevision,
            mode: result.mode, action: result.action });
          void vscode.window.showInformationMessage(
            `Sandbox подтвердил ${binding.relativePath} (ревизия ${result.workspaceRevision}).` +
            (result.mode === "legacy" ? " Внимание: прежний режим Sandbox без CAS fence." : ""),
          );
          break;
        }
        case "auto-sync-status": {
          this.reportAutoSyncState();
          break;
        }
        case "auto-sync-enable": {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.uri.scheme !== "file") {
            throw new Error("Открой исходный файл урока для включения синхронизации.");
          }
          const binding = checkoutFileForSync(localRoot(), editor.document.uri.fsPath);
          if (this.autoSyncTasks.has(binding.sandboxId)) {
            throw new Error("Автосинхронизация этого задания уже включена. Для сброса конфликта сначала выключи её.");
          }
          const origin = apiBaseURL();
          if (!origin || !(await this.auth().getAccessToken())) {
            throw new Error("Для отправки изменений сначала войди в аккаунт Codechuman.");
          }
          const baseline = this.acknowledgedFences.get(binding.sandboxId);
          if (!baseline || baseline.origin !== origin) {
            throw new Error("Сначала выполни ручную синхронизацию файла: для авто-режима нужен подтверждённый atomic fence Sandbox.");
          }
          let expectedFenceEpoch = baseline.epoch;
          const sandbox = new SandboxHttpSync(origin);
          const queue = new DebouncedSandboxQueue(async (file, content) => {
            if (apiBaseURL() !== origin) throw new Error("Адрес Gateway изменился: автосинхронизация остановлена.");
            const token = await this.auth().getAccessToken();
            if (!token) throw new Error("Сессия Codechuman завершена.");
            const ack = await sandbox.syncFile({ sandboxId: binding.sandboxId,
              relativePath: file, content, token }, { requireFence: true, expectedFenceEpoch });
            if (ack.fenceEpoch === undefined) throw new Error("Sandbox не подтвердил atomic fence.");
            expectedFenceEpoch = ack.fenceEpoch;
            this.acknowledgedFences.set(binding.sandboxId, { origin, epoch: expectedFenceEpoch });
            this.send({ type: "sync", revision: ack.workspaceRevision, mode: ack.mode, action: ack.action });
          }, (error) => {
            const detail = error instanceof Error ? error.message : "Ошибка Sandbox";
            this.send({ type: "error", message: `Автосинхронизация остановлена: ${detail}` });
            this.reportAutoSyncState();
            void vscode.window.showWarningMessage(`Codechuman Auto Sync остановлен: ${detail}`);
          });
          queue.enable();
          this.autoSyncTasks.set(binding.sandboxId, queue);
          this.reportAutoSyncState();
          void vscode.window.showInformationMessage(
            "Автосинхронизация задания включена для следующих изменений (debounce 1 секунда, fenced ACK).",
          );
          break;
        }
        case "auto-sync-disable": {
          this.disableAutoSync();
          void vscode.window.showInformationMessage("Автосинхронизация Codechuman выключена.");
          break;
        }
        case "doctor": {
          const result = await cli(["doctor"]) as { git_available: boolean; node_available: boolean };
          this.send({ type: "status", cliAvailable: true, git_available: !!result.git_available, node_available: !!result.node_available });
          break;
        }
        case "list": {
          const result = await cli(["list", "--root", localRoot()]) as LocalCheckout[];
          this.send({ type: "courses", entries: Array.isArray(result) ? result : [] });
          break;
        }
        case "open": {
          const directory = checkedDirectory(message.directory);
          // Keep the user's current workspace intact; replacing it would
          // interrupt edits and reload the Codechuman sidebar.
          const source = vscode.Uri.file(path.join(directory, "app.js"));
          const document = await vscode.workspace.openTextDocument(source);
          await vscode.window.showTextDocument(document, { preview: false });
          break;
        }
        case "validate": {
          const directory = checkedDirectory(message.directory);
          const result = await cli(["validate-js", "--workspace", directory, "--file", message.file]) as LocalDiagnostic;
          this.send({ type: "validation", result });
          break;
        }
        case "validate-public": {
          const directory = checkedDirectory(message.directory);
          const result = await cli(["validate-public-js", "--workspace", directory]) as LocalDiagnostic;
          this.send({ type: "validation", result });
          break;
        }
        case "read-material": {
          const directory = checkedDirectory(message.directory);
          this.send({ type: "material", name: message.material,
            content: readLessonMaterial(directory, message.material) });
          break;
        }
        case "list-examples": {
          const directory = checkedDirectory(message.directory);
          this.send({ type: "examples", directory, names: listLocalExamples(directory) });
          break;
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.send({ type: "error", message: detail });
      if (!this.view || message.type === "sync-active" || message.type === "auto-sync-enable") {
        void vscode.window.showErrorMessage(detail);
      }
      if (message.type === "doctor") {
        this.send({ type: "status", cliAvailable: false, git_available: false, node_available: false,
          message: "Установи codechuman-cli из GitHub Releases и настрой путь в Codechuman Settings." });
      }
    }
  }

  private html(webview: vscode.Webview): string {
    const index = readFileSync(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.html").fsPath, "utf8");
    const script = index.match(/<script[^>]+src="([^"]+)"/);
    const stylesheet = index.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/);
    if (!script) throw new Error("Codechuman webview bundle not found. Run npm run build.");
    const asset = (uri: string): string => {
      const safe = uri.replace(/^\.\//, "");
      if (!safe.startsWith("assets/") || safe.includes("..")) throw new Error("Unsafe webview asset");
      return webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", safe)).toString();
    };
    const nonce = crypto.randomBytes(16).toString("base64");
    const scriptURL = asset(script[1]);
    const styleURL = stylesheet ? asset(stylesheet[1]) : undefined;
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
      ${styleURL ? `<link rel="stylesheet" href="${styleURL}" />` : ""}
      </head><body><div id="root"></div>
      <script type="module" nonce="${nonce}" src="${scriptURL}"></script></body></html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const sidebar = new SidebarProvider(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codechuman.sidebar", sidebar));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.open", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.codechuman");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.refresh", () => sidebar.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.signIn", () => sidebar.run({ type: "sign-in" })));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.signOut", () => sidebar.run({ type: "sign-out" })));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.checkoutRemote", () => sidebar.run({ type: "checkout-remote" })));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.syncActive", () => sidebar.run({ type: "sync-active" })));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.autoSyncEnable", () => sidebar.run({ type: "auto-sync-enable" })));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.autoSyncDisable", () => sidebar.run({ type: "auto-sync-disable" })));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.contentChanges.length > 0) sidebar.onDocumentChanged(event.document);
  }));
}

export function deactivate(): void {}
