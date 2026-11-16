import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listLocalExamples, readLessonMaterial } from "../shared/materials";

const folders: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "codechuman-materials-"));
  folders.push(root);
  mkdirSync(join(root, ".learning", "examples"), { recursive: true });
  writeFileSync(join(root, ".learning", "lesson.md"), "# Local lesson");
  writeFileSync(join(root, ".learning", "task.md"), "Complete answer()");
  writeFileSync(join(root, ".learning", "quiz.json"), '{"questions":[]}');
  writeFileSync(join(root, ".learning", "examples", "first.js"), "const answer = 42;");
  return root;
}

afterEach(() => folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })));

describe("local Codechuman materials", () => {
  it("reads only permitted cached lesson, task, quiz and example files", () => {
    const root = fixture();
    expect(readLessonMaterial(root, "lesson.md")).toBe("# Local lesson");
    expect(readLessonMaterial(root, "task.md")).toBe("Complete answer()");
    expect(readLessonMaterial(root, "quiz.json")).toBe('{"questions":[]}');
    expect(readLessonMaterial(root, "examples/first.js")).toBe("const answer = 42;");
    expect(listLocalExamples(root)).toEqual(["examples/first.js"]);
  });

  it("denies traversal, hidden tests, symlinked material and oversized contents", () => {
    const root = fixture();
    const foreign = join(root, "foreign.txt");
    writeFileSync(foreign, "private");
    expect(() => readLessonMaterial(root, "../foreign.txt")).toThrow();
    expect(() => readLessonMaterial(root, "tests/hidden.js")).toThrow();
    expect(() => readLessonMaterial(root, "examples/../../foreign.txt")).toThrow();
    symlinkSync(foreign, join(root, ".learning", "examples", "secret.js"));
    expect(() => readLessonMaterial(root, "examples/secret.js")).toThrow();
    expect(listLocalExamples(root)).toEqual(["examples/first.js"]);
    writeFileSync(join(root, ".learning", "lesson.md"), "x".repeat(513 * 1024));
    expect(() => readLessonMaterial(root, "lesson.md")).toThrow();
    expect(lstatSync(join(root, ".learning", "examples", "secret.js")).isSymbolicLink()).toBe(true);
  });
});

describe('revision-pinned remote materials',()=>{
 it('opens only the pinned digest-checked public revision offline',()=>{
  const root=fixture(),rev='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const learning=join(root,'.learning'),cache=join(learning,'materials',rev);mkdirSync(cache,{recursive:true});
  const ids={task_instance_id:'22222222-2222-4222-8222-222222222222',course_id:'88888888-8888-4888-8888-888888888888',lesson_id:'99999999-9999-4999-8999-999999999999',lesson_revision:rev};
  writeFileSync(join(learning,'manifest.json'),JSON.stringify({schema:'codechuman.checkout.v1',...ids}));
  writeFileSync(join(cache,'lesson.md'),'# pinned');
  writeFileSync(join(cache,'manifest.json'),JSON.stringify({schema:'codechuman.ide-material-cache.v1',...ids,files:[{path:'lesson.md',sha256:'sha256:'+createHash('sha256').update('# pinned').digest('hex')}]}));
  expect(readLessonMaterial(root,'lesson.md')).toBe('# pinned');expect(listLocalExamples(root)).toEqual([]);
  writeFileSync(join(cache,'lesson.md'),'tampered');expect(()=>readLessonMaterial(root,'lesson.md')).toThrow();
  rmSync(cache,{recursive:true});expect(()=>readLessonMaterial(root,'lesson.md')).toThrow();
 });
});
