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
  | { type: "open"; directory: string }
  | { type: "validate"; directory: string; file: string }
  | { type: "validate-public"; directory: string };

export type ServerMessage =
  | { type: "status"; git_available: boolean; node_available: boolean; cliAvailable: boolean; message?: string }
  | { type: "courses"; entries: LocalCheckout[] }
  | { type: "validation"; result: LocalDiagnostic }
  | { type: "error"; message: string };

export function isClientRequest(value: unknown): value is ClientRequest {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (input.type === "doctor" || input.type === "list") return true;
  if (input.type === "open") return typeof input.directory === "string" && input.directory.length > 0;
  if (input.type === "validate-public") return typeof input.directory === "string" && input.directory.length > 0;
  if (input.type === "validate") {
    return typeof input.directory === "string" && input.directory.length > 0 &&
      typeof input.file === "string" && input.file.length > 0;
  }
  return false;
}
