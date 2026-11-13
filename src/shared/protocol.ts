export interface CheckoutManifest {
  schema: "codechuman.checkout.v1";
  course_id: string;
  course_slug: string;
  lesson_id: string;
  lesson_number: number;
  lesson_revision: string;
  task_instance_id: string;
  sandbox_id: string;
}

export interface LocalCheckout {
  directory: string;
  manifest: CheckoutManifest;
}

export interface LocalDiagnostic {
  status: "PASS" | "FAIL" | "UNAVAILABLE" | "NO_TESTS";
  details?: string;
}

export type ClientRequest =
  | { type: "doctor" }
  | { type: "list" }
  | { type: "auth-status" }
  | { type: "sign-in" }
  | { type: "sign-out" }
  | { type: "checkout-remote" }
  | { type: "sync-active" }
  | { type: "open"; directory: string }
  | { type: "validate"; directory: string; file: string }
  | { type: "validate-public"; directory: string }
  | { type: "read-material"; directory: string; material: string }
  | { type: "list-examples"; directory: string };

export type ServerMessage =
  | { type: "status"; git_available: boolean; node_available: boolean; cliAvailable: boolean; message?: string }
  | { type: "auth"; configured: boolean; connected: boolean }
  | { type: "sync"; revision: number; mode: "fenced" | "legacy"; action: "created" | "updated" }
  | { type: "courses"; entries: LocalCheckout[] }
  | { type: "validation"; result: LocalDiagnostic }
  | { type: "material"; name: string; content: string }
  | { type: "examples"; directory: string; names: string[] }
  | { type: "error"; message: string };

export function isClientRequest(value: unknown): value is ClientRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (input.type === "doctor" || input.type === "list" || input.type === "auth-status" ||
      input.type === "sign-in" || input.type === "sign-out" || input.type === "checkout-remote" ||
      input.type === "sync-active") return true;
  if (input.type === "open") return typeof input.directory === "string" && input.directory.length > 0;
  if (input.type === "validate-public") return typeof input.directory === "string" && input.directory.length > 0;
  if (input.type === "list-examples") return typeof input.directory === "string" && input.directory.length > 0;
  if (input.type === "read-material") {
    return typeof input.directory === "string" && input.directory.length > 0 &&
      typeof input.material === "string" && input.material.length > 0;
  }
  if (input.type === "validate") {
    return typeof input.directory === "string" && input.directory.length > 0 &&
      typeof input.file === "string" && input.file.length > 0;
  }
  return false;
}
