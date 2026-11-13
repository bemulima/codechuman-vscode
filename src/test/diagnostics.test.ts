import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { localValidationLocations } from "../shared/diagnostics";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });

describe("Sandbox diagnostics local source mapping", () => {
  it("maps only verified files inside the exact downloaded lesson", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ch-ide28-diagnostic-"));
    roots.push(root);
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "app.js"), "bad");
    const foreign = mkdtempSync(path.join(tmpdir(), "ch-ide28-foreign-"));
    roots.push(foreign);
    writeFileSync(path.join(foreign, "secret.js"), "secret");
    symlinkSync(path.join(foreign, "secret.js"), path.join(root, "src", "linked.js"));
    const errors = [
      { code: "PARSER", message: "Unexpected token", file: "src/app.js", line: 3, column: 5, severity: "error" as const },
      { code: "LEAK", message: "bad", file: "src/linked.js", line: 1, column: 1, severity: "error" as const },
      { code: "MISS", message: "missing", file: "src/missing.js", line: 1, column: 1, severity: "error" as const },
    ];
    const locations = localValidationLocations(root, errors);
    expect(locations).toEqual([{ filePath: path.join(root, "src", "app.js"), issue: errors[0] }]);
  });
});
