import { lstatSync, realpathSync } from "node:fs";
import * as path from "node:path";
import type { SandboxValidationIssue } from "./sandbox";

export interface LocalValidationLocation {
  filePath: string;
  issue: SandboxValidationIssue;
}

// Server validators report workspace-relative paths. Resolve them against the
// exact pinned lesson checkout, not the student's current VS Code workspace.
// Never let a reported path (including symlinks) annotate an unrelated file.
export function localValidationLocations(checkoutDirectory: string, issues: SandboxValidationIssue[]): LocalValidationLocation[] {
  const root = realpathSync(checkoutDirectory);
  const result: LocalValidationLocation[] = [];
  for (const issue of issues.slice(0, 100)) {
    if (!issue.file || issue.file.startsWith("/") || issue.file.includes("\\") ||
        issue.file.split("/").some((part) => !part || part.startsWith(".") || part === "..")) continue;
    try {
      const requested = path.join(root, ...issue.file.split("/"));
      if (!lstatSync(requested).isFile()) continue;
      const filePath = realpathSync(requested);
      const relative = path.relative(root, filePath);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      result.push({ filePath, issue });
    } catch {
      // Missing files and invalid symlink targets are not local diagnostics.
    }
  }
  return result;
}
