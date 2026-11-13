import { lstatSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";

const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export interface CheckoutFileBinding {
  sandboxId: string;
  relativePath: string;
  checkoutDirectory: string;
}

// Resolve the active editor file only from a cached CLI-created Git checkout.
// Nothing in the webview can supply an arbitrary sandbox_id or file path.
export function checkoutFileForSync(rootInput: string, documentPath: string): CheckoutFileBinding {
  const root = realpathSync(rootInput);
  const file = realpathSync(documentPath);
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Файл находится вне локального каталога Codechuman.");
  }
  const segments = relative.split(path.sep);
  if (segments.length < 3 || !SLUG.test(segments[0]) || segments[0] === "." || segments[0] === ".." ||
      !/^\d{2,4}$/.test(segments[1])) {
    throw new Error("Выбери файл внутри каталога <курс>/<урок>/.");
  }
  const checkout = path.join(root, segments[0], segments[1]);
  const git = path.join(checkout, ".git");
  const learning = path.join(checkout, ".learning");
  const manifestPath = path.join(learning, "manifest.json");
  if (!lstatSync(git).isDirectory() || !lstatSync(learning).isDirectory() ||
      !lstatSync(manifestPath).isFile()) {
    throw new Error("Задание не является доверенным локальным checkout Codechuman.");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.schema !== "codechuman.checkout.v1" || manifest.course_slug !== segments[0] ||
      manifest.lesson_number !== Number(segments[1]) || typeof manifest.sandbox_id !== "string" ||
      !UUID.test(manifest.sandbox_id)) {
    throw new Error("Некорректная привязка задания к Sandbox.");
  }
  return { sandboxId: manifest.sandbox_id, relativePath: segments.slice(2).join("/"), checkoutDirectory: checkout };
}
