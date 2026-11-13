import { randomUUID } from "node:crypto";

export interface SandboxSyncInput {
  sandboxId: string;
  relativePath: string;
  content: string;
  token: string;
}

export interface SandboxSyncAck {
  workspaceRevision: number;
  fenceEpoch?: number;
  mode: "fenced" | "legacy";
  action: "created" | "updated";
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

function safeRelativePath(p: string): boolean {
  if (!p || p.length > 256 || p.startsWith("/") || p.includes("\\") || p.includes("\0") ||
      p.includes("\r") || p.includes("\n") || p.includes(":")) return false;
  const segments = p.split("/");
  return segments.every((part) => !!part && part !== ".." && !part.startsWith(".") &&
    !["node_modules", "vendor", "dist"].includes(part));
}

function strictOrigin(input: string): string {
  let origin: URL;
  try { origin = new URL(input); } catch { throw new Error("Укажи HTTPS origin Codechuman Gateway."); }
  if (origin.protocol !== "https:" || !origin.hostname || origin.username || origin.password ||
      origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("Sandbox sync требует HTTPS origin без пути и учётных данных.");
  }
  return origin.origin;
}

async function boundedJSON(response: Response): Promise<unknown> {
  if (response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") {
    throw new Error("Sandbox вернул не JSON.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Sandbox вернул пустой ответ.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.length;
        if (size > MAX_RESPONSE_BYTES) throw new Error("Слишком большой ответ Sandbox.");
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Некорректный JSON Sandbox."); }
}

// The Gateway already authenticates the student and overwrites actor headers;
// it forwards this existing REST API to ms-go-sandbox. No new server route is
// required for live file writes. Official Practice Submit remains separate.
export class SandboxHttpSync {
  constructor(private readonly rawOrigin: string, private readonly request: typeof fetch = fetch) {}

  private async call(
    method: "GET" | "POST" | "PUT", url: string, bearer: string,
    extraHeaders: Record<string, string> = {}, body?: string,
  ): Promise<{ status: number; data?: unknown }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.request(url, {
        method, redirect: "manual", signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${bearer}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        ...(body !== undefined ? { body } : {}),
      });
      if (response.status === 404) return { status: 404 };
      if (response.status === 409) throw new Error("Sandbox: конфликт ревизии/fence. Обнови состояние перед повторной синхронизацией.");
      if (!response.ok) throw new Error(`Sandbox sync: HTTP ${response.status}.`);
      return { status: response.status, data: await boundedJSON(response) };
    } finally {
      clearTimeout(timeout);
    }
  }

  async syncFile(input: SandboxSyncInput, options: { requireFence?: boolean; expectedFenceEpoch?: number } = {}): Promise<SandboxSyncAck> {
    const origin = strictOrigin(this.rawOrigin);
    if (!UUID.test(input.sandboxId)) throw new Error("Некорректный Sandbox ID.");
    if (!safeRelativePath(input.relativePath)) throw new Error("Запрещённый относительный путь Sandbox.");
    if (typeof input.content !== "string" || input.content.includes("\0") ||
        Buffer.byteLength(input.content, "utf8") > MAX_FILE_BYTES) {
      throw new Error("Файл слишком большой или не является текстовым.");
    }
    if (typeof input.token !== "string" || input.token.length < 6 || input.token.length > 8192 ||
        /[\s\0]/.test(input.token)) throw new Error("Некорректный токен Auth.");

    const base = `${origin}/api/sandbox/v1/sandboxes/${input.sandboxId}`;
    const fence = await this.call("GET", `${base}/workspace-fence`, input.token);
    let fenceEpoch: number | undefined;
    if (fence.status === 404 && options.requireFence) {
      throw new Error("Atomic Sandbox fence недоступен: автоматическая синхронизация остановлена. Ручная отправка остаётся доступна.");
    }
    if (fence.status !== 404) {
      const state = fence.data as Record<string, unknown> | undefined;
      if (!state || state.schema !== "sandbox-workspace-fence.v1" || state.sandboxId !== input.sandboxId ||
          !Number.isSafeInteger(state.fenceEpoch) || Number(state.fenceEpoch) < 0) {
        throw new Error("Некорректный fence Sandbox.");
      }
      fenceEpoch = Number(state.fenceEpoch);
    }

    if (options.expectedFenceEpoch !== undefined) {
      if (!Number.isSafeInteger(options.expectedFenceEpoch) || options.expectedFenceEpoch < 0 ||
          fenceEpoch !== options.expectedFenceEpoch) {
        throw new Error("Сервер изменил Sandbox после последнего ACK: локальная версия устарела. Автосинхронизация остановлена.");
      }
    }

    const existing = await this.call("GET", `${base}/files?path=${encodeURIComponent(input.relativePath)}`, input.token);
    const created = existing.status === 404;
    const method = created ? "POST" : "PUT";
    const ack = await this.call(method, `${base}/files`, input.token, {
      "Idempotency-Key": randomUUID(),
      ...(fenceEpoch === undefined ? {} : { "X-Sandbox-Fence-Epoch": String(fenceEpoch) }),
    }, JSON.stringify({ path: input.relativePath, content: input.content }));

    const response = ack.data as Record<string, unknown> | undefined;
    const revision = response?.workspaceRevision;
    const events = response?.events;
    const expectedEvent = created ? "file_created" : "file_updated";
    const confirmed = Array.isArray(events) && events.some((event: unknown) => {
      if (!event || typeof event !== "object") return false;
      const e = event as Record<string, unknown>;
      const payload = e.payload as Record<string, unknown> | undefined;
      return e.event === expectedEvent && payload?.path === input.relativePath && payload?.workspaceRevision === revision;
    });
    if (!confirmed || !Number.isSafeInteger(revision) || Number(revision) < 1) {
      throw new Error("Sandbox не подтвердил запись файла (ACK). Повторная отправка отключена.");
    }
    const nextFence = response?.fenceEpoch;
    if (fenceEpoch !== undefined && (!Number.isSafeInteger(nextFence) || Number(nextFence) <= fenceEpoch)) {
      throw new Error("Sandbox не подтвердил продвижение fence. Проверь сохранение вручную.");
    }
    return {
      workspaceRevision: Number(revision),
      ...(fenceEpoch === undefined ? {} : { fenceEpoch: Number(nextFence) }),
      mode: fenceEpoch === undefined ? "legacy" : "fenced",
      action: created ? "created" : "updated",
    };
  }
}
