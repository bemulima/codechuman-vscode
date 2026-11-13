import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { checkoutFileForSync } from "../shared/workspace";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function sample() {
  const root = mkdtempSync(path.join(tmpdir(), "ch-ide28-ws-"));
  roots.push(root);
  const lesson = path.join(root, "js-beginner", "01");
  mkdirSync(path.join(lesson, ".learning"), { recursive: true });
  mkdirSync(path.join(lesson, ".git"));
  mkdirSync(path.join(lesson, "src"));
  const file = path.join(lesson, "src", "app.js");
  writeFileSync(file, "let x = 1;");
  const manifest = { schema: "codechuman.checkout.v1", course_slug: "js-beginner", lesson_number: 1,
    sandbox_id: "af58f58d-3bea-4129-87ac-0581efcbefc1" };
  writeFileSync(path.join(lesson, ".learning", "manifest.json"), JSON.stringify(manifest));
  return { root, lesson, file, manifest };
}

describe("Local workspace to Sandbox binding", () => {
  it("maps a saved nested lesson file to its exact cached Sandbox ID and relative path", () => {
    const { root, file, manifest } = sample();
    expect(checkoutFileForSync(root, file)).toEqual({
      relativePath: "src/app.js", sandboxId: manifest.sandbox_id,
      checkoutDirectory: path.join(root, "js-beginner", "01"),
    });
  });

  it("rejects files outside root or symlinks to another location", () => {
    const { root, lesson } = sample();
    const outside = mkdtempSync(path.join(tmpdir(), "ch-ide28-outside-"));
    roots.push(outside);
    const secret = path.join(outside, "secret.js");
    writeFileSync(secret, "secret");
    symlinkSync(secret, path.join(lesson, "outside.js"));
    expect(() => checkoutFileForSync(root, secret)).toThrow();
    expect(() => checkoutFileForSync(root, path.join(lesson, "outside.js"))).toThrow();
  });

  it("rejects spoofed manifest binding and symlinked metadata", () => {
    const { root, lesson, file, manifest } = sample();
    writeFileSync(path.join(lesson, ".learning", "manifest.json"), JSON.stringify({ ...manifest, lesson_number: 2 }));
    expect(() => checkoutFileForSync(root, file)).toThrow();
    rmSync(path.join(lesson, ".learning"), { recursive: true });
    const external = mkdtempSync(path.join(tmpdir(), "ch-ide28-manifest-"));
    roots.push(external);
    writeFileSync(path.join(external, "manifest.json"), JSON.stringify(manifest));
    symlinkSync(external, path.join(lesson, ".learning"));
    expect(() => checkoutFileForSync(root, file)).toThrow();
  });
});
