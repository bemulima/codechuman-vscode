import { createHash } from "node:crypto";
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

function boundedFile(filename:string,max:number):Buffer {
 const stat=lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('Небезопасный учебный кэш.');
 const raw=readFileSync(filename);if(raw.length>max)throw new Error('Слишком большой кэш.');return raw;
}
function cacheRoot(checkoutDir:string):{root:string;digests?:Map<string,string>} {
 const directory=path.join(realpathSync(checkoutDir),'.learning');
 const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Учебный кэш повреждён.');
 const manifestPath=path.join(directory,'manifest.json');
 let checkout:Record<string,unknown>;
 try{checkout=JSON.parse(boundedFile(manifestPath,16384).toString('utf8'));}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {root:directory};throw e;}
 if(checkout.lesson_revision===undefined)return {root:directory};
 const rev=checkout.lesson_revision;
 if(typeof rev!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(rev)||checkout.schema!=='codechuman.checkout.v1')throw new Error('Некорректная ревизия кэша.');
 let root=directory;
 for(const component of ['materials',rev]){root=path.join(root,component);const st=lstatSync(root);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Небезопасная ревизия кэша.');}
 const cache=JSON.parse(boundedFile(path.join(root,'manifest.json'),65536).toString('utf8')) as Record<string,unknown>;
 if(cache.schema!=='codechuman.ide-material-cache.v1'||!Array.isArray(cache.files)||cache.files.length>100)throw new Error('Некорректный manifest материалов.');
 for(const key of ['task_instance_id','course_id','lesson_id','lesson_revision'])if(typeof checkout[key]!=='string'||cache[key]!==checkout[key])throw new Error('Несовпадение привязки материалов.');
 const digests=new Map<string,string>();
 for(const file of cache.files){if(!file||typeof file.path!=='string'||typeof file.sha256!=='string'||!/^sha256:[0-9a-f]{64}$/.test(file.sha256)||digests.has(file.path))throw new Error('Некорректный digest материалов.');checkedMaterialPath(file.path);digests.set(file.path,file.sha256);}
 return {root,digests};
}

export function readLessonMaterial(checkoutDir: string, name: string): string {
  const components = checkedMaterialPath(name);
  const cache=cacheRoot(checkoutDir);
  if(cache.digests&&!cache.digests.has(name))throw new Error("Материал отсутствует в закреплённой ревизии.");
  let filename = cache.root;
  for (let i = 0; i < components.length; i++) {
    filename = path.join(filename, components[i]);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink() ||
        (i !== components.length - 1 && !stat.isDirectory()) ||
        (i === components.length - 1 && (!stat.isFile() || stat.size > MAX_MATERIAL_BYTES))) {
      throw new Error("Учебный материал недоступен или превышает допустимый размер.");
    }
  }
  const raw=boundedFile(filename,MAX_MATERIAL_BYTES);
  if(cache.digests && cache.digests.get(name)!=="sha256:"+createHash("sha256").update(raw).digest("hex"))throw new Error("Digest материала не совпадает.");
  return new TextDecoder("utf-8",{fatal:true}).decode(raw);
}

export function listLocalExamples(checkoutDir: string): string[] {
  const cache=cacheRoot(checkoutDir);
  if(cache.digests){const names=[...cache.digests.keys()].filter(n=>n.startsWith("examples/"));for(const n of names)readLessonMaterial(checkoutDir,n);return names.sort();}
  const examplesRoot = path.join(cache.root, "examples");
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
