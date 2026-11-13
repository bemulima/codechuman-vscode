import { describe, expect, it } from "vitest";
import { SandboxHttpSync } from "../shared/sandbox";

const ID = "af58f58d-3bea-4129-87ac-0581efcbefc1";

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json" },
  });
}

describe("Codechuman Sandbox HTTP file sync", () => {
  it("creates an absent file with an atomic fence and accepts only the write ACK", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses = [
      json(200, { schema: "sandbox-workspace-fence.v1", sandboxId: ID, fenceEpoch: 4 }),
      json(404, { error: "file not found" }),
      json(200, { workspaceRevision: 12, fenceEpoch: 5, events: [
        { event: "file_created", payload: { path: "src/app.js", workspaceRevision: 12, fenceEpoch: 5 } },
      ] }),
    ];
    const request: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return responses.shift()!;
    };
    const sync = new SandboxHttpSync("https://learn.example.org", request);
    const ack = await sync.syncFile({ sandboxId: ID, relativePath: "src/app.js", content: "export const x = 1;", token: "valid.access.token" });
    expect(ack).toEqual({ workspaceRevision: 12, fenceEpoch: 5, mode: "fenced", action: "created" });
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "GET", "POST"]);
    expect(calls[2].url).toBe(`https://learn.example.org/api/sandbox/v1/sandboxes/${ID}/files`);
    expect(calls[2].init.redirect).toBe("manual");
    const h = new Headers(calls[2].init.headers);
    expect(h.get("Authorization")).toBe("Bearer valid.access.token");
    expect(h.get("X-Sandbox-Fence-Epoch")).toBe("4");
    expect(h.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ path: "src/app.js", content: "export const x = 1;" });
    expect(calls.every((call) => !call.url.includes("valid.access.token"))).toBe(true);
  });

  it("updates an existing legacy Sandbox file with an explicit legacy-mode ACK", async () => {
    const requests: RequestInit[] = [];
    const responses = [
      json(404, { error: "sandbox fence unavailable" }),
      json(200, { path: "app.js", content: "old", workspaceRevision: 3 }),
      json(200, { workspaceRevision: 4, events: [
        { event: "file_updated", payload: { path: "app.js", workspaceRevision: 4 } },
      ] }),
    ];
    const request: typeof fetch = async (_input, init) => { requests.push(init ?? {}); return responses.shift()!; };
    const ack = await new SandboxHttpSync("https://learn.example.org", request).syncFile({
      sandboxId: ID, relativePath: "app.js", content: "new", token: "valid.access.token",
    });
    expect(ack).toEqual({ workspaceRevision: 4, mode: "legacy", action: "updated" });
    expect(requests[2].method).toBe("PUT");
    expect(new Headers(requests[2].headers).get("X-Sandbox-Fence-Epoch")).toBeNull();
  });

  it("rejects fence conflicts, redirects and missing acknowledgements instead of reporting success", async () => {
    const input = { sandboxId: ID, relativePath: "app.js", content: "new", token: "valid.access.token" };
    const conflict = [
      json(200, { schema: "sandbox-workspace-fence.v1", sandboxId: ID, fenceEpoch: 7 }),
      json(200, { path: "app.js", content: "old" }),
      json(409, { error: "sandbox_fence_conflict" }),
    ];
    await expect(new SandboxHttpSync("https://learn.example.org", async () => conflict.shift()!).syncFile(input))
      .rejects.toThrow(/конфликт|conflict/i);
    await expect(new SandboxHttpSync("https://learn.example.org", async () =>
      new Response(null, { status: 302, headers: { Location: "https://evil.example" } })).syncFile(input))
      .rejects.toThrow();
    const bad = [json(404, {}), json(200, {}), json(200, {
      workspaceRevision: 4, events: [{ event: "validation_result", payload: { workspaceRevision: 4 } }],
    })];
    await expect(new SandboxHttpSync("https://learn.example.org", async () => bad.shift()!).syncFile(input))
      .rejects.toThrow(/подтвержд|ACK/i);
  });

  it("rejects unsafe paths, oversized buffers, insecure gateways and invalid ids before network access", async () => {
    let calls = 0;
    const spy: typeof fetch = async () => { calls++; throw new Error("Network must not be used"); };
    const input = { sandboxId: ID, relativePath: "app.js", content: "x", token: "valid.access.token" };
    for (const relativePath of ["../secret.txt", ".env", ".learning/manifest.json", "a\\b.js", "/etc/passwd", "a//b.js"]) {
      await expect(new SandboxHttpSync("https://learn.example.org", spy).syncFile({ ...input, relativePath })).rejects.toThrow();
    }
    await expect(new SandboxHttpSync("http://learn.example.org", spy).syncFile(input)).rejects.toThrow();
    await expect(new SandboxHttpSync("https://learn.example.org", spy).syncFile({ ...input, sandboxId: "../foreign" })).rejects.toThrow();
    await expect(new SandboxHttpSync("https://learn.example.org", spy).syncFile({ ...input, content: "x".repeat(1024 * 1024) })).rejects.toThrow();
    expect(calls).toBe(0);
  });
});
