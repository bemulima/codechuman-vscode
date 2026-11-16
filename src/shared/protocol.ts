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
  | {type:"official-submit";directory:string;scope:"MILESTONE"|"FINAL"}
  | { type: "teacher-send"; directory: string; body: string }
  | { type: "teacher-refresh"; directory: string }
  | { type: "sandbox-check"; directory: string }
  | { type: "doctor" }
  | { type: "list" }
  | { type: "auth-status" }
  | { type: "sign-in" }
  | { type: "sign-out" }
  | { type: "checkout-remote" }
  | { type: "sync-active" }
  | { type: "auto-sync-enable" }
  | { type: "auto-sync-disable" }
  | { type: "auto-sync-status" }
  | { type: "open"; directory: string }
  | { type: "validate"; directory: string; file: string }
  | { type: "validate-public"; directory: string }
  | { type: "read-material"; directory: string; material: string }
  | { type: "list-examples"; directory: string };

export type ServerMessage =
  | {type:"official-receipt";directory:string;result:import("./teacher").SubmitReply}
  | { type: "task-selected";directory:string }
  | { type: "task-busy"; directory:string; busy:boolean }
  | { type: "teacher"; directory:string; reply:import("./teacher").TeacherReply }
  | { type: "code-check"; directory:string; result:import("./teacher").CodeCheckReply }
  | { type: "status"; git_available: boolean; node_available: boolean; cliAvailable: boolean; message?: string }
  | { type: "auth"; configured: boolean; connected: boolean }
  | { type: "sync"; revision: number; mode: "fenced" | "legacy"; action: "created" | "updated" }
  | { type: "sandbox-validation"; revision: number; observation: SandboxValidationObservation | null }
  | { type: "auto-sync"; enabled: boolean; activeTasks: number; halted: boolean }
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
      input.type === "sync-active" || input.type === "auto-sync-enable" || input.type === "auto-sync-disable" ||
      input.type === "auto-sync-status") return true;
  if(input.type==='official-submit')return typeof input.directory==='string'&&input.directory.length>0&&(input.scope==='MILESTONE'||input.scope==='FINAL');
  if(input.type==='teacher-send')return typeof input.directory==='string'&&input.directory.length>0&&typeof input.body==='string'&&input.body.trim().length>0&&input.body.length<=12000;
  if(input.type==='teacher-refresh'||input.type==='sandbox-check')return typeof input.directory==='string'&&input.directory.length>0;
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
import type { SandboxValidationObservation } from "./sandbox";

