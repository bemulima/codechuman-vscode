import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import * as path from "node:path";

const MAX_MATERIAL_BYTES = 512 * 1024;
const allowedSingles = new Set(["lesson.md", "task.md", "quiz.json"]);
const safeComponent = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/;

function checkedMaterialPath(name: string): string[] {
  if (allowedSingles.has(name)) return [name];
  if (!name.startsWith("examples/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("Недоступный учебный материал.");
  }
  const components = name.split("/");
  if (components.length < 2 || components.length > 6 || components[0] !== "examples" ||
      components.slice(1).some((part) => !safeComponent.test(part) || part === "." || part === "..")) {
    throw new Error("Недопустимый путь учебного примера.");
  }
  return components;
}

function cacheRoot(checkoutDir: string): string {
  const directory = path.join(realpathSync(checkoutDir), ".learning");
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Учебный кэш повреждён.");
  }
  return realpathSync(directory);
}

export function readLessonMaterial(checkoutDir: string, name: string): string {
  const components = checkedMaterialPath(name);
  let filename = cacheRoot(checkoutDir);
  for (let i = 0; i < components.length; i++) {
    filename = path.join(filename, components[i]);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink() ||
        (i !== components.length - 1 && !stat.isDirectory()) ||
        (i === components.length - 1 && (!stat.isFile() || stat.size > MAX_MATERIAL_BYTES))) {
      throw new Error("Учебный материал недоступен или превышает допустимый размер.");
    }
  }
  return readFileSync(filename, "utf8");
}

export function listLocalExamples(checkoutDir: string): string[] {
  const examplesRoot = path.join(cacheRoot(checkoutDir), "examples");
  let root;
  try {
    root = lstatSync(examplesRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error("Каталог примеров повреждён.");
  }
  const found: string[] = [];
  const visit = (absolute: string, relative: string, depth: number): void => {
    if (depth > 5) return;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!safeComponent.test(entry.name) || entry.name === "." || entry.name === "..") continue;
      const rel = path.posix.join(relative, entry.name);
      const current = path.join(absolute, entry.name);
      if (entry.isDirectory()) {
        visit(current, rel, depth + 1);
      } else if (entry.isFile()) {
        found.push(rel);
        if (found.length > 100) throw new Error("Слишком много файлов-примеров.");
      }
    }
  };
  visit(examplesRoot, "examples", 1);
  return found.sort();
}
