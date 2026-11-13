import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DebouncedSandboxQueue } from "../shared/auto-sync";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); });

describe("Codechuman opt-in Sandbox auto-sync", () => {
  it("is disabled by default and sends only the newest edit after one second", async () => {
    const send = vi.fn(async (_path: string, _content: string) => undefined);
    const queue = new DebouncedSandboxQueue(send, () => undefined, 1_000);
    queue.schedule("app.js", "first");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).not.toHaveBeenCalled();

    queue.enable();
    queue.schedule("app.js", "a");
    await vi.advanceTimersByTimeAsync(700);
    queue.schedule("app.js", "ab");
    await vi.advanceTimersByTimeAsync(999);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("app.js", "ab");
  });

  it("serializes different files and retains changes made while a request is in flight", async () => {
    let resolveFirst!: () => void;
    const blocker = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const calls: Array<[string, string]> = [];
    const send = async (file: string, content: string) => {
      calls.push([file, content]);
      if (calls.length === 1) await blocker;
    };
    const queue = new DebouncedSandboxQueue(send, () => undefined, 1_000);
    queue.enable();
    queue.schedule("app.js", "v1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toEqual([["app.js", "v1"]]);

    queue.schedule("app.js", "v2");
    queue.schedule("lib.js", "new");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(1);
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([["app.js", "v1"], ["app.js", "v2"], ["lib.js", "new"]]);
  });

  it("halts on a failed ACK or conflict, never blindly retries and preserves unsent content", async () => {
    const failure = vi.fn();
    const send = vi.fn(async () => { throw new Error("sandbox_fence_conflict"); });
    const queue = new DebouncedSandboxQueue(send, failure, 1_000);
    queue.enable();
    queue.schedule("app.js", "my changes");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(queue.isHalted).toBe(true);
    expect(queue.pendingCount).toBe(1);
    queue.schedule("app.js", "another edit");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    queue.disable();
    expect(queue.pendingCount).toBe(0);
  });

  it("stops pending sends when a student disables automatic sync", async () => {
    const send = vi.fn(async () => undefined);
    const queue = new DebouncedSandboxQueue(send, () => undefined, 1_000);
    queue.enable();
    queue.schedule("src/app.js", "changes");
    queue.disable();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).not.toHaveBeenCalled();
    expect(queue.isEnabled).toBe(false);
  });
});
