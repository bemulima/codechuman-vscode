import { createHash } from "node:crypto";

export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

const MAX_AUTH_RESPONSE_BYTES = 16 * 1024;

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 6 && value.length <= 8192 &&
    /^[a-zA-Z0-9._~+\/-]+={0,2}$/.test(value);
}

async function boundedJSON(response: Response): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Auth вернул пустой ответ.");
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_AUTH_RESPONSE_BYTES) throw new Error("Слишком большой ответ Auth.");
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

// Existing ms-go-auth SignIn/Refresh endpoints through the student Gateway.
// Password is held only for the duration of a TLS request and never persisted.
export class AuthSession {
  private pendingRefresh?: Promise<string>;

  constructor(
    private readonly rawOrigin: string,
    private readonly secrets: SecretStore,
    private readonly request: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private origin(): string {
    let url: URL;
    try {
      url = new URL(this.rawOrigin);
    } catch {
      throw new Error("Укажи HTTPS адрес Codechuman Gateway.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        url.pathname !== "/" || !url.hostname) {
      throw new Error("Codechuman Gateway должен быть HTTPS origin без пути и учётных данных.");
    }
    return url.origin;
  }

  private key(suffix: string): string {
    const digest = createHash("sha256").update(this.origin()).digest("hex").slice(0, 20);
    return `codechuman.session.${digest}.${suffix}`;
  }

  private async post(path: string, payload: unknown, bearer?: string): Promise<Tokens> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await this.request(this.origin() + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Codechuman Auth вернул HTTP ${response.status}.`);
      const mediaType = response.headers.get("Content-Type")?.split(";")[0].trim();
      if (mediaType !== "application/json") throw new Error("Codechuman Auth вернул не JSON.");
      const raw = await boundedJSON(response);
      if (!raw || typeof raw !== "object") throw new Error("Некорректный ответ Auth.");
      const parsed = raw as Record<string, unknown>;
      if (!validToken(parsed.access_token) || !validToken(parsed.refresh_token) ||
          !Number.isSafeInteger(parsed.expires_in) || Number(parsed.expires_in) <= 0 ||
          Number(parsed.expires_in) > 2_592_000) {
        throw new Error("Некорректные токены Codechuman Auth.");
      }
      return parsed as unknown as Tokens;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async storeTokens(tokens: Tokens): Promise<void> {
    await this.secrets.store(this.key("access"), tokens.access_token);
    await this.secrets.store(this.key("refresh"), tokens.refresh_token);
    await this.secrets.store(this.key("expiresAt"), String(this.now() + tokens.expires_in * 1000));
  }

  async signIn(email: string, password: string): Promise<void> {
    if (!email.trim() || !password) throw new Error("Введите email и пароль Codechuman.");
    const tokens = await this.post("/api/auth/v1/auth/signin", { email: email.trim(), password });
    await this.storeTokens(tokens);
  }

  async isSignedIn(): Promise<boolean> {
    return !!(await this.secrets.get(this.key("refresh")));
  }

  async getAccessToken(): Promise<string | undefined> {
    const refresh = await this.secrets.get(this.key("refresh"));
    if (!refresh) return undefined;
    const expiresAt = Number(await this.secrets.get(this.key("expiresAt"))) || 0;
    const access = await this.secrets.get(this.key("access"));
    if (access && expiresAt > this.now() + 15_000) return access;
    if (!this.pendingRefresh) {
      const pending = this.refreshTokens(refresh);
      this.pendingRefresh = pending;
      void pending.then(
        () => { if (this.pendingRefresh === pending) this.pendingRefresh = undefined; },
        () => { if (this.pendingRefresh === pending) this.pendingRefresh = undefined; },
      );
    }
    return this.pendingRefresh;
  }

  private async refreshTokens(refresh: string): Promise<string> {
    const tokens = await this.post("/api/auth/v1/auth/refresh", { refresh_token: refresh });
    await this.storeTokens(tokens);
    return tokens.access_token;
  }

  async signOut(): Promise<void> {
    const refresh = await this.secrets.get(this.key("refresh"));
    const access = await this.secrets.get(this.key("access"));
    await Promise.all(["access", "refresh", "expiresAt"].map((suffix) => this.secrets.delete(this.key(suffix))));
    // Local logout always succeeds. Revocation is best effort if offline.
    if (refresh) {
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 5_000);
      try {
        await this.request(this.origin() + "/api/auth/v1/auth/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(access ? { Authorization: `Bearer ${access}` } : {}) },
          redirect: "manual",
          body: JSON.stringify({ refresh_token: refresh }),
          signal: timeout.signal,
        });
      } catch {
        // A network failure cannot retain local credentials.
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
