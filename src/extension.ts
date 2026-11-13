import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { ClientRequest, LocalCheckout, LocalDiagnostic, ServerMessage } from "./shared/protocol";
import { isClientRequest } from "./shared/protocol";

function localRoot(): string {
  const setting = vscode.workspace.getConfiguration("codechuman").get<string>("workspaceRoot", "~/.codechuman");
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

function cli(args: string[]): Promise<unknown> {
  const binary = vscode.workspace.getConfiguration("codechuman").get<string>("cliPath", "codechuman");
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    // Public CLI checks have their own 20s deadline; allow enough time for
    // the child to report the real result before killing a stuck process.
    const timeout = setTimeout(() => child.kill(), 30000);
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

  constructor(private readonly extensionUri: vscode.Uri) {}

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
  }

  private send(message: ServerMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private async handle(message: ClientRequest): Promise<void> {
    try {
      switch (message.type) {
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
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.send({ type: "error", message: detail });
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
  const sidebar = new SidebarProvider(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codechuman.sidebar", sidebar));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.open", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.codechuman");
  }));
  context.subscriptions.push(vscode.commands.registerCommand("codechuman.refresh", () => sidebar.refresh()));
}

export function deactivate(): void {}
