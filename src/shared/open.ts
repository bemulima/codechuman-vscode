import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";

const COURSE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const LESSON_NUMBER = /^\d{2,4}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_SCANNED_ENTRIES = 10_000;
const MAX_SCAN_DEPTH = 64;
const MAX_SOURCE_FILES = 1_000;
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;

const SOURCE_EXTENSIONS = new Set([
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".php", ".go", ".py", ".pyi", ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".rs", ".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".hxx", ".java",
  ".kt", ".kts", ".swift", ".cs", ".rb", ".sh", ".bash", ".zsh", ".lua",
  ".sql", ".r", ".dart", ".scala", ".ex", ".exs", ".erl", ".hrl",
  ".clj", ".cljs", ".cljc", ".fs", ".fsx", ".hs", ".lhs", ".elm",
  ".pl", ".pm", ".m", ".mm", ".vue", ".svelte", ".astro",
]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".learning", ".vscode", ".idea", ".next", ".nuxt", ".cache",
  ".pytest_cache", ".mypy_cache", ".gradle", ".terraform", "node_modules",
  "vendor", "dist", "build", "coverage", "target", "out", "pods", "venv",
  ".venv", "__pycache__", "tmp", "temp", "log", "logs",
]);

export interface CheckoutSourceFile {
  label: string;
  absolutePath: string;
}

function isInside(parent: string, candidate: string, allowEqual = false): boolean {
  const relative = path.relative(parent, candidate);
  if (allowEqual && relative === "") return true;
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function checkedDirectoryPath(rootInput: string, checkoutInput: string): { root: string; checkout: string } {
  const root = realpathSync(rootInput);
  const requested = path.resolve(checkoutInput);
  const relative = path.relative(root, requested);
  const segments = relative.split(path.sep);
  if (segments.length !== 2 || !COURSE_SLUG.test(segments[0]) ||
      segments[0] === "." || segments[0] === ".." || !LESSON_NUMBER.test(segments[1])) {
    throw new Error("Выберите checkout Codechuman формата <курс>/<урок> внутри workspace.");
  }

  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Каталог checkout Codechuman не должен содержать символические ссылки.");
    }
  }
  const checkout = realpathSync(current);
  if (!isInside(root, checkout)) {
    throw new Error("Checkout находится вне локального workspace Codechuman.");
  }
  return { root, checkout };
}

function validateCheckout(rootInput: string, checkoutInput: string): string {
  const { checkout } = checkedDirectoryPath(rootInput, checkoutInput);
  const gitPath = path.join(checkout, ".git");
  const learningPath = path.join(checkout, ".learning");
  const manifestPath = path.join(learningPath, "manifest.json");
  const git = lstatSync(gitPath);
  const learning = lstatSync(learningPath);
  const manifestStat = lstatSync(manifestPath);
  if (!git.isDirectory() || git.isSymbolicLink() || !learning.isDirectory() || learning.isSymbolicLink() ||
      !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("Задание не является доверенным локальным checkout Codechuman.");
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Не удалось проверить манифест локального checkout Codechuman.");
  }
  const relative = path.relative(realpathSync(rootInput), checkout).split(path.sep);
  const requiredIds = ["course_id", "lesson_id", "lesson_revision", "task_instance_id"];
  if (manifest.schema !== "codechuman.checkout.v1" || manifest.course_slug !== relative[0] ||
      manifest.lesson_number !== Number(relative[1]) || requiredIds.some((key) =>
        typeof manifest[key] !== "string" || !(manifest[key] as string).trim()) ||
      typeof manifest.sandbox_id !== "string" || !UUID.test(manifest.sandbox_id)) {
    throw new Error("Некорректная привязка задания к манифесту Codechuman.");
  }
  return checkout;
}

function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "authorized_keys" || lower === "known_hosts" || lower === "token.json" ||
    /^\.env(?:\..*)?$/.test(lower) || /^(?:secret|secrets|credential|credentials)(?:\..*)?$/.test(lower) ||
    /\.(?:pem|key|p12|pfx|jks|keystore|crt|cer)$/.test(lower) ||
    /^(?:id_rsa|id_ed25519)(?:\..*)?$/.test(lower);
}

export function listCheckoutSourceFiles(rootInput: string, checkoutInput: string): CheckoutSourceFile[] {
  const checkout = validateCheckout(rootInput, checkoutInput);
  const found: CheckoutSourceFile[] = [];
  let scanned = 0;

  const walk = (directory: string, depth = 0): void => {
    if (depth > MAX_SCAN_DEPTH) {
      throw new Error("Структура checkout слишком глубоко вложена для безопасного поиска исходника.");
    }
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_SCANNED_ENTRIES) {
        throw new Error("В checkout слишком много файлов для безопасного поиска исходника.");
      }
      if (entry.name.startsWith(".")) continue;
      const candidate = path.join(directory, entry.name);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        let target: string;
        try {
          target = realpathSync(candidate);
        } catch {
          throw new Error("В checkout обнаружена недопустимая символическая ссылка.");
        }
        if (!isInside(checkout, target, true)) {
          throw new Error("Open отклонён: символическая ссылка ведёт за пределы checkout.");
        }
        continue;
      }
      if (stat.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase())) walk(candidate, depth + 1);
        continue;
      }
      if (!stat.isFile() || isSecretName(entry.name) || stat.size > MAX_SOURCE_FILE_BYTES) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const actual = realpathSync(candidate);
      if (!isInside(checkout, actual)) {
        throw new Error("Open отклонён: исходный файл находится за пределами checkout.");
      }
      found.push({
        label: path.relative(checkout, actual).split(path.sep).join("/"),
        absolutePath: actual,
      });
      if (found.length > MAX_SOURCE_FILES) {
        throw new Error("В checkout слишком много исходных файлов для открытия.");
      }
    }
  };

  walk(checkout);
  return found.sort((left, right) => left.label.localeCompare(right.label));
}

export async function chooseCheckoutSourceFile(
  files: CheckoutSourceFile[],
  pick: (options: CheckoutSourceFile[]) => Promise<string | undefined>,
): Promise<CheckoutSourceFile | undefined> {
  if (files.length === 0) {
    throw new Error("В этом задании не найден поддерживаемый исходный файл.");
  }
  if (files.length === 1) return files[0];

  const selectedPath = await pick(files);
  if (selectedPath === undefined) return undefined;
  const selected = files.find((file) => file.absolutePath === selectedPath);
  if (!selected) throw new Error("Выбранный файл не принадлежит этому checkout Codechuman.");
  return selected;
}

export function verifyCheckoutSourceFile(
  rootInput: string,
  checkoutInput: string,
  fileInput: string,
): string {
  const checkout = validateCheckout(rootInput, checkoutInput);
  const requested = path.resolve(fileInput);
  const stat = lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Open разрешён только для обычного исходного файла внутри checkout.");
  }
  const file = realpathSync(requested);
  if (!isInside(checkout, file) || isSecretName(path.basename(file)) ||
      !SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    throw new Error("Open отклонён: выбранный файл находится вне checkout или не является исходником.");
  }
  return file;
}
