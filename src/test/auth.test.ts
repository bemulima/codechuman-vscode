import { describe, expect, it } from "vitest";
import { AuthSession, type SecretStore } from "../shared/auth";

class TestSecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key); }
  async store(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

function jsonTokens(access: string, refresh: string, expires = 900): Response {
  return new Response(JSON.stringify({ access_token: access, refresh_token: refresh, expires_in: expires }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Codechuman native Auth session", () => {
  it("signs in through the existing gateway and saves only tokens, never a password", async () => {
    const store = new TestSecrets();
    const requests: Array<{ url: string; body: string; redirect: RequestRedirect }> = [];
    const request: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body), redirect: init?.redirect ?? "follow" });
      return jsonTokens("access.jwt.value", "refresh.jwt.value");
    };
    const session = new AuthSession("https://codechuman.example", store, request);
    await session.signIn("student@example.org", "my-test-password");
    expect(requests[0].url).toBe("https://codechuman.example/api/auth/v1/auth/signin");
    expect(requests[0].redirect).toBe("manual");
    expect(JSON.parse(requests[0].body)).toEqual({ email: "student@example.org", password: "my-test-password" });
    expect(await session.getAccessToken()).toBe("access.jwt.value");
    expect([...store.values.values()].join(",")).not.toContain("my-test-password");
    expect(await session.isSignedIn()).toBe(true);
  });

  it("rejects insecure origins and cross-origin redirect responses", async () => {
    const store = new TestSecrets();
    const fakeFetch: typeof fetch = async () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
    await expect(new AuthSession("http://codechuman.example", store, fakeFetch).signIn("user", "pass")).rejects.toThrow();
    await expect(new AuthSession("https://codechuman.example", store, fakeFetch).signIn("user", "pass")).rejects.toThrow();
    expect(store.values.size).toBe(0);
  });

  it("refreshes an expiring token exactly once and isolates secrets by gateway origin", async () => {
    const store = new TestSecrets();
    let clock = 100_000;
    let refreshCalls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input).endsWith("/signin")) return jsonTokens("access.old", "refresh.old", 1);
      if (String(input).endsWith("/refresh")) {
        refreshCalls++;
        return jsonTokens("access.new", "refresh.new", 900);
      }
      throw new Error("Unexpected request");
    };
    const session = new AuthSession("https://codechuman.example", store, fakeFetch, () => clock);
    await session.signIn("student@example.org", "password");
    clock += 2_000;
    const [first, second] = await Promise.all([session.getAccessToken(), session.getAccessToken()]);
    expect(first).toBe("access.new");
    expect(second).toBe("access.new");
    expect(refreshCalls).toBe(1);
    const foreign = new AuthSession("https://foreign.example", store, fakeFetch, () => clock);
    expect(await foreign.getAccessToken()).toBeUndefined();
  });

  it("removes local credentials on sign-out even if the server is unreachable", async () => {
    const store = new TestSecrets();
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input).endsWith("/signin")) return jsonTokens("access.jwt", "refresh.jwt");
      throw new Error("Offline");
    };
    const session = new AuthSession("https://codechuman.example", store, fakeFetch);
    await session.signIn("student@example.org", "password");
    await session.signOut();
    expect(await session.isSignedIn()).toBe(false);
    expect(store.values.size).toBe(0);
  });
});
