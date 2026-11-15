import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const vscodeApi: any = vi.hoisted(() => ({
  window: {
    registerWebviewViewProvider: vi.fn(),
    showTextDocument: vi.fn(),
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeTextDocument: vi.fn(),
    openTextDocument: vi.fn(),
  },
  commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
  languages: { createDiagnosticCollection: vi.fn() },
  Uri: { file: vi.fn(), joinPath: vi.fn() },
}));

vi.mock("vscode", () => vscodeApi);

import { activate } from "../extension";

const roots: string[] = [];
let checkout: string;
let extensionRoot: string;
let messageHandler: ((value: unknown) => void) | undefined;
let webviewPost: ReturnType<typeof vi.fn>;

function uri(fsPath: string) {
  return { scheme: "file", fsPath, path: fsPath, toString: () => `file://${fsPath}` };
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ide28-open-"));
  roots.push(root);
  const lesson = path.join(root, "sample-course", "01");
  mkdirSync(path.join(lesson, ".git"), { recursive: true });
  mkdirSync(path.join(lesson, ".learning"), { recursive: true });
  writeFileSync(path.join(lesson, ".learning", "manifest.json"), JSON.stringify({
    schema: "codechuman.checkout.v1",
    course_id: "8c8b3d3c-678e-45d8-9b9a-8ba684e9f451",
    course_slug: "sample-course",
    lesson_id: "a2e676bf-5b83-42f1-8393-7baf7b9fb139",
    lesson_number: 1,
    lesson_revision: "revision-1",
    task_instance_id: "4f937379-dbe9-43c9-916f-c81a32a70c94",
    sandbox_id: "af58f58d-3bea-4129-87ac-0581efcbefc1",
  }));
  return { root, lesson };
}

async function startExtension(): Promise<void> {
  const { root, lesson } = fixture();
  checkout = lesson;
  extensionRoot = path.join(root, "extension");
  mkdirSync(path.join(extensionRoot, "dist", "webview", "assets"), { recursive: true });
  writeFileSync(path.join(extensionRoot, "dist", "webview", "index.html"),
    '<link rel="stylesheet" href="./assets/index.css"><script type="module" src="./assets/index.js"></script>');

  vscodeApi.Uri.file.mockImplementation(uri);
  vscodeApi.Uri.joinPath.mockImplementation((base: { fsPath: string }, ...parts: string[]) =>
    uri(path.join(base.fsPath, ...parts)));
  vscodeApi.workspace.getConfiguration.mockReturnValue({
    inspect: () => undefined,
    get: (key: string, fallback: string) => key === "workspaceRoot" ? root : fallback,
  });
  vscodeApi.workspace.onDidChangeTextDocument.mockReturnValue({ dispose: vi.fn() });
  vscodeApi.workspace.openTextDocument.mockImplementation(async (source: { fsPath: string }) => {
    if (!existsSync(source.fsPath)) throw new Error("Исходный файл не найден.");
    return { uri: source };
  });
  vscodeApi.window.registerWebviewViewProvider.mockReturnValue({ dispose: vi.fn() });
  vscodeApi.window.showTextDocument.mockResolvedValue(undefined);
  vscodeApi.window.showQuickPick.mockImplementation(async (items: Array<{ path: string }>) => items[0]);
  vscodeApi.window.showErrorMessage.mockResolvedValue(undefined);
  vscodeApi.window.showInformationMessage.mockResolvedValue(undefined);
  vscodeApi.commands.registerCommand.mockReturnValue({ dispose: vi.fn() });
  vscodeApi.commands.executeCommand.mockResolvedValue(undefined);
  vscodeApi.languages.createDiagnosticCollection.mockReturnValue({
    clear: vi.fn(), delete: vi.fn(), dispose: vi.fn(), set: vi.fn(),
  });

  const context = { extensionUri: uri(extensionRoot), subscriptions: [] };
  activate(context as never);
  const provider = vscodeApi.window.registerWebviewViewProvider.mock.calls[0][1];
  const webview = {
    options: undefined,
    html: "",
    cspSource: "vscode-resource:",
    asWebviewUri: (value: { toString(): string }) => value.toString(),
    onDidReceiveMessage: (handler: (value: unknown) => void) => {
      messageHandler = handler;
      return { dispose: vi.fn() };
    },
    postMessage: vi.fn(),
  };
  webviewPost = webview.postMessage;
  provider.resolveWebviewView({ webview });
}

async function openCheckout(): Promise<void> {
  if (!messageHandler) throw new Error("Webview message handler was not registered.");
  messageHandler({ type: "open", directory: checkout });
  await vi.waitFor(() => {
    expect(vscodeApi.window.showTextDocument.mock.calls.length + webviewPost.mock.calls.length).toBeGreaterThan(0);
  });
}

function canonical(file: string): string {
  return realpathSync(file);
}

function postedMessages(): string {
  return webviewPost.mock.calls.flat().map((value: unknown) =>
    value && typeof value === "object" ? JSON.stringify(value) : String(value),
  ).join(" ");
}

beforeEach(() => {
  vi.resetAllMocks();
  messageHandler = undefined;
  webviewPost = vi.fn();
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Codechuman Open command", () => {
  it("opens app.js when it is the only source file", async () => {
    await startExtension();
    writeFileSync(path.join(checkout, "app.js"), "const answer = 42;\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonical(path.join(checkout, "app.js")) }),
    );
    expect(vscodeApi.window.showTextDocument).toHaveBeenCalled();
    expect(vscodeApi.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("opens src/main.ts when it is the only source file", async () => {
    await startExtension();
    mkdirSync(path.join(checkout, "src"), { recursive: true });
    writeFileSync(path.join(checkout, "src", "main.ts"), "export const answer = 42;\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonical(path.join(checkout, "src", "main.ts")) }),
    );
    expect(vscodeApi.window.showTextDocument).toHaveBeenCalled();
  });

  it.each(["main.go", "index.php"])("opens %s when it is the only source file", async (file) => {
    await startExtension();
    writeFileSync(path.join(checkout, file), "// source\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonical(path.join(checkout, file)) }),
    );
    expect(vscodeApi.window.showTextDocument).toHaveBeenCalled();
  });

  it("lets the student choose when a checkout has multiple source files", async () => {
    await startExtension();
    mkdirSync(path.join(checkout, "src"), { recursive: true });
    writeFileSync(path.join(checkout, "src", "main.ts"), "export const answer = 42;\n");
    writeFileSync(path.join(checkout, "main.go"), "package main\n");
    vscodeApi.window.showQuickPick.mockImplementation(async (items: Array<{ label: string; file: { absolutePath: string } }>) =>
      items.find((item) => item.label === "src/main.ts"));

    await openCheckout();

    expect(vscodeApi.window.showQuickPick).toHaveBeenCalledOnce();
    expect(vscodeApi.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonical(path.join(checkout, "src", "main.ts")) }),
    );
  });

  it("shows a useful message when there is no supported source file", async () => {
    await startExtension();
    writeFileSync(path.join(checkout, "README.md"), "instructions only\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("не найден поддерживаемый исходный файл");
  });

  it("rejects a symlink whose target is outside the checkout", async () => {
    await startExtension();
    const outside = mkdtempSync(path.join(tmpdir(), "ide28-open-outside-"));
    roots.push(outside);
    const outsideFile = path.join(outside, "secret.ts");
    writeFileSync(outsideFile, "export const secret = true;\n");
    mkdirSync(path.join(checkout, "src"), { recursive: true });
    symlinkSync(outsideFile, path.join(checkout, "src", "linked.ts"));

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("символическая ссылка ведёт за пределы checkout");
  });

  it("rejects a checkout directory outside the configured workspace", async () => {
    await startExtension();
    const outside = mkdtempSync(path.join(tmpdir(), "ide28-open-foreign-"));
    roots.push(outside);
    checkout = path.join(outside, "foreign-course", "01");
    mkdirSync(path.join(checkout, ".git"), { recursive: true });
    mkdirSync(path.join(checkout, ".learning"), { recursive: true });
    writeFileSync(path.join(checkout, ".learning", "manifest.json"), "{}");
    writeFileSync(path.join(checkout, "main.ts"), "export {};\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("внутри Codechuman workspace");
  });

  it("rejects a checkout with an invalid identity manifest", async () => {
    await startExtension();
    writeFileSync(path.join(checkout, ".learning", "manifest.json"), JSON.stringify({ schema: "wrong.v1" }));
    writeFileSync(path.join(checkout, "main.ts"), "export {};\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("Некорректная привязка задания к манифесту Codechuman");
  });

  it("does not offer files from .git, .learning, or node_modules", async () => {
    await startExtension();
    mkdirSync(path.join(checkout, "src"), { recursive: true });
    mkdirSync(path.join(checkout, "node_modules", "pkg"), { recursive: true });
    writeFileSync(path.join(checkout, "app.js"), "const answer = 42;\n");
    writeFileSync(path.join(checkout, ".git", "internal.ts"), "secret\n");
    writeFileSync(path.join(checkout, ".learning", "private.py"), "secret\n");
    writeFileSync(path.join(checkout, "node_modules", "pkg", "dependency.js"), "library\n");
    writeFileSync(path.join(checkout, ".env"), "TOKEN=must-not-open\n");
    writeFileSync(path.join(checkout, "secret.ts"), "do not open\n");
    writeFileSync(path.join(checkout, "credentials.json"), "{}\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: canonical(path.join(checkout, "app.js")) }),
    );
    expect(vscodeApi.window.showQuickPick).not.toHaveBeenCalled();
  });

  it("bounds the depth of recursive source discovery", async () => {
    await startExtension();
    let nested = checkout;
    for (let index = 0; index < 66; index += 1) {
      nested = path.join(nested, `d${index}`);
      mkdirSync(nested);
    }
    writeFileSync(path.join(nested, "main.py"), "print('safe')\n");

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("слишком глубоко вложена");
  });

  it("leaves local edits and checkout metadata unchanged", async () => {
    await startExtension();
    mkdirSync(path.join(checkout, "src"), { recursive: true });
    const source = path.join(checkout, "src", "main.ts");
    const localEdit = "export const answer = 42;\n// local student edit\n";
    const manifest = path.join(checkout, ".learning", "manifest.json");
    writeFileSync(source, localEdit);
    const manifestBefore = readFileSync(manifest, "utf8");

    await openCheckout();

    expect(readFileSync(source, "utf8")).toBe(localEdit);
    expect(readFileSync(manifest, "utf8")).toBe(manifestBefore);
  });

  it("rejects a QuickPick result that is not one of the checkout files", async () => {
    await startExtension();
    writeFileSync(path.join(checkout, "main.go"), "package main\n");
    writeFileSync(path.join(checkout, "index.php"), "<?php\n");
    const outside = mkdtempSync(path.join(tmpdir(), "ide28-open-pick-"));
    roots.push(outside);
    const outsideFile = path.join(outside, "outside.ts");
    writeFileSync(outsideFile, "export {};\n");
    vscodeApi.window.showQuickPick.mockResolvedValue({ label: "outside.ts", file: { absolutePath: outsideFile } });

    await openCheckout();

    expect(vscodeApi.workspace.openTextDocument).not.toHaveBeenCalled();
    expect(postedMessages()).toContain("не принадлежит этому checkout Codechuman");
  });
});
