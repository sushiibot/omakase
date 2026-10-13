import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedFiles } from "./files.ts";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "sushii-shares-"));
  dirs.push(dir);
  const root = join(dir, "shared");
  await mkdir(root);
  return {
    dir,
    root,
    files: new SharedFiles([
      { id: "docs", name: "Docs", path: root, coding: false },
    ]),
  };
}
describe("shared machine files", () => {
  test("lists and pages text without allowing coding or escaping the root", async () => {
    const { dir, root, files } = await fixture();
    await writeFile(join(root, "notes.txt"), "a".repeat(33000));
    await writeFile(join(dir, "private.txt"), "private");
    await symlink(join(dir, "private.txt"), join(root, "outside"));
    const read = (await files.request({
      action: "read",
      machineId: "pc",
      rootId: "docs",
      path: "notes.txt",
    })) as any;
    expect(read.text.length).toBe(32000);
    expect(read.hasMore).toBe(true);
    expect(
      (
        (await files.request({
          action: "read",
          machineId: "pc",
          rootId: "docs",
          path: "notes.txt",
          offset: 32000,
        })) as any
      ).text.length,
    ).toBe(1000);
    await expect(files.path("docs", "../private.txt")).rejects.toThrow(
      "leaves",
    );
    await expect(files.path("docs", "outside")).rejects.toThrow("Symlink");
    await expect(files.path("docs", "/etc/passwd")).rejects.toThrow("relative");
    await expect(files.path("docs", ".", true)).rejects.toThrow("not shared");
  });
  test("searches literal text and excludes binary files and outside symlinks", async () => {
    const { dir, root, files } = await fixture();
    await writeFile(join(root, "notes.txt"), "hello\n$(echo hello)\nworld");
    await writeFile(
      join(root, "binary"),
      Buffer.from([0, 104, 101, 108, 108, 111]),
    );
    await writeFile(join(dir, "secret"), "hello");
    await symlink(join(dir, "secret"), join(root, "leak"));
    const result = (await files.request({
      action: "search",
      machineId: "pc",
      rootId: "docs",
      query: "$(echo hello)",
    })) as any;
    expect(result.matches).toEqual([
      { path: "./notes.txt", line: 2, text: "$(echo hello)" },
    ]);
    await expect(
      files.request({
        action: "read",
        machineId: "pc",
        rootId: "docs",
        path: "binary",
      }),
    ).rejects.toThrow("binary");
  });
  test("a coding folder path must be an existing folder inside a coding root", async () => {
    const { dir, root } = await fixture();
    const files = new SharedFiles([
      { id: "code", name: "Code", path: root, coding: true },
      { id: "docs", name: "Docs", path: root, coding: false },
    ]);
    await mkdir(join(root, "repo", "web"), { recursive: true });
    await writeFile(join(root, "repo", "README.md"), "hi");
    await mkdir(join(dir, "outside"));
    await symlink(join(dir, "outside"), join(root, "escape"));
    await symlink(join(root, "repo"), join(root, "alias"));
    expect(await files.codingDir("code")).toEqual({ cwd: await realpath(root), path: undefined });
    expect(await files.codingDir("code", "repo/web")).toEqual({
      cwd: await realpath(join(root, "repo", "web")),
      path: "repo/web",
    });
    // A symlink that stays inside resolves to the folder it names.
    expect((await files.codingDir("code", "alias")).path).toBe("repo");
    await expect(files.codingDir("code", "../outside")).rejects.toThrow("'..'");
    await expect(files.codingDir("code", "repo/../../outside")).rejects.toThrow("'..'");
    await expect(files.codingDir("code", join(dir, "outside"))).rejects.toThrow("relative");
    await expect(files.codingDir("code", "C:\\Windows")).rejects.toThrow("relative");
    await expect(files.codingDir("code", "escape")).rejects.toThrow("Symlink");
    await expect(files.codingDir("code", "repo/README.md")).rejects.toThrow("not a folder");
    await expect(files.codingDir("code", "missing")).rejects.toThrow("does not exist");
    await expect(files.codingDir("docs", "repo")).rejects.toThrow("not shared");
  });
});
