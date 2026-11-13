import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

describe("Codechuman extension security configuration", () => {
  it("cannot accept Git executable or auth origin from an untrusted workspace", () => {
    const props = manifest.contributes.configuration.properties;
    expect(props["codechuman.apiBaseUrl"].scope).toBe("application");
    expect(props["codechuman.cliPath"].scope).toBe("application");
    expect(props["codechuman.workspaceRoot"].scope).toBe("application");
  });
});
