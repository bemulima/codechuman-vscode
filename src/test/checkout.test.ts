import { describe, expect, it } from "vitest";
import { checkoutRemoteArgs } from "../shared/checkout";

const taskID = "22222222-2222-4222-8222-222222222222";

describe("Codechuman CLI remote checkout arguments", () => {
  it("uses the exact authenticated descriptor v1 command with no bearer or legacy schema", () => {
    const args = checkoutRemoteArgs("https://learn.example.org", taskID, "/tmp/student-cache");
    expect(args).toEqual(["checkout-remote", "--api-base", "https://learn.example.org",
      "--task-instance", taskID, "--root", "/tmp/student-cache", "--token-stdin"]);
    expect(args).not.toContain("--schema");
    expect(args).not.toContain("--token");
  });

  it("rejects malformed task identity and non-HTTPS endpoint before spawning the CLI", () => {
    expect(checkoutRemoteArgs("https://learn.example.org/", taskID, "/tmp/cache")[2])
      .toBe("https://learn.example.org/");
    expect(() => checkoutRemoteArgs("https://learn.example.org", "../malicious", "/tmp/cache")).toThrow();
    expect(() => checkoutRemoteArgs("http://learn.example.org", taskID, "/tmp/cache")).toThrow();
    expect(() => checkoutRemoteArgs("https://student:secret@learn.example.org", taskID, "/tmp/cache")).toThrow();
    expect(() => checkoutRemoteArgs("https://learn.example.org/api", taskID, "/tmp/cache")).toThrow();
  });
});
