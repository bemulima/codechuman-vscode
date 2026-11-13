import { describe, expect, it } from "vitest";
import { isClientRequest } from "../shared/protocol";

describe("Codechuman webview protocol", () => {
  it("rejects arbitrary commands and malformed paths", () => {
    expect(isClientRequest({ type: "shell", command: "rm -rf /" })).toBe(false);
    expect(isClientRequest({ type: "open", directory: 5 })).toBe(false);
    expect(isClientRequest({ type: "validate", directory: "/tmp", file: null })).toBe(false);
    expect(isClientRequest({ type: "validate-public", directory: 5 })).toBe(false);
    expect(isClientRequest(null)).toBe(false);
  });

  it("accepts only supported actions", () => {
    expect(isClientRequest({ type: "doctor" })).toBe(true);
    expect(isClientRequest({ type: "list" })).toBe(true);
    expect(isClientRequest({ type: "open", directory: "/tmp/js/01" })).toBe(true);
    expect(isClientRequest({ type: "validate", directory: "/tmp/js/01", file: "app.js" })).toBe(true);
    expect(isClientRequest({ type: "validate-public", directory: "/tmp/js/01" })).toBe(true);
  });
});
