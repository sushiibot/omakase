import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { agentPath, fileRequest } from "../../orchestration/machines/contracts.ts";
export interface SharedRoot {
  id: string;
  name: string;
  path: string;
  coding: boolean;
}
const within = (base: string, path: string) => {
  const rel = relative(base, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
};
export class SharedFiles {
  constructor(readonly roots: SharedRoot[]) {}
  async path(rootId: string, path = ".", coding = false) {
    const root = this.roots.find((r) => r.id === rootId);
    if (!root || (coding && !root.coding))
      throw new Error("This folder is not shared for that operation.");
    if (isAbsolute(path))
      throw new Error("Use a path relative to the shared folder.");
    const base = await realpath(root.path);
    const lexical = resolve(base, path);
    if (!within(base, lexical))
      throw new Error("Path leaves the shared folder.");
    const target = await realpath(lexical);
    if (!within(base, target))
      throw new Error("Symlink leaves the shared folder.");
    return target;
  }
  /** A coding session's working folder: an existing directory inside a coding root, with its path from the root. */
  async codingDir(rootId: string, path?: string) {
    const checked = path === undefined ? "." : agentPath.safeParse(path);
    if (typeof checked !== "string" && !checked.success)
      throw new Error(checked.error.issues[0]?.message ?? "Invalid folder path.");
    const base = await this.path(rootId, ".", true);
    let cwd: string;
    try {
      cwd = await this.path(rootId, typeof checked === "string" ? checked : checked.data, true);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw new Error(`Folder ${path} does not exist in this coding folder.`);
      throw err;
    }
    if (!(await stat(cwd)).isDirectory()) throw new Error(`${path} is a file, not a folder.`);
    const rel = relative(base, cwd).split(sep).join("/");
    if (rel.length > 2000) throw new Error("The folder path is too long.");
    return { cwd, path: rel || undefined };
  }
  private async text(path: string, offset: number, base: string) {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink())
      throw new Error("Only regular text files can be read.");
    const fd = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      if (
        process.platform === "linux" &&
        !within(base, await realpath(`/proc/self/fd/${fd.fd}`))
      )
        throw new Error("File moved outside the shared folder.");
      const stat = await fd.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev)
        throw new Error("File changed; retry the read.");
      const bytes = Buffer.alloc(32000);
      const { bytesRead } = await fd.read(bytes, 0, bytes.length, offset);
      const data = bytes.subarray(0, bytesRead);
      if (data.includes(0))
        throw new Error("This is a binary file; text reads are supported.");
      return {
        text: data.toString("utf8"),
        offset,
        nextOffset: offset + bytesRead,
        hasMore: offset + bytesRead < stat.size,
      };
    } finally {
      await fd.close();
    }
  }
  async request(raw: unknown) {
    const p = fileRequest.parse(raw);
    const target = await this.path(p.rootId, p.path);
    const base = await this.path(p.rootId);
    if (p.action === "read") return this.text(target, p.offset, base);
    if (p.action === "list") {
      const entries = (await readdir(target, { withFileTypes: true })).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
      return {
        entries: entries
          .slice(p.offset, p.offset + 200)
          .map((e) => ({
            name: e.name,
            kind: e.isSymbolicLink()
              ? "symlink"
              : e.isDirectory()
                ? "directory"
                : e.isFile()
                  ? "file"
                  : "other",
          })),
        nextOffset: p.offset + 200,
        hasMore: entries.length > p.offset + 200,
      };
    }
    if (!p.query) throw new Error("Search requires query text.");
    const matches: { path: string; line: number; text: string }[] = [];
    const queue = [p.path];
    let visited = 0;
    let bytes = 0;
    while (
      queue.length &&
      visited < 1000 &&
      bytes < 4000000 &&
      matches.length < 100
    ) {
      const path = queue.shift()!;
      visited++;
      try {
        const resolved = await this.path(p.rootId, path);
        const stat = await lstat(resolved);
        if (stat.isDirectory()) {
          for (const entry of (
            await readdir(resolved, { withFileTypes: true })
          ).slice(0, 1000)) {
            if (
              !entry.isSymbolicLink() &&
              ![".git", "node_modules"].includes(entry.name)
            )
              queue.push(`${path}/${entry.name}`);
            if (queue.length >= 1000) break;
          }
        } else if (stat.isFile()) {
          const data = await this.text(resolved, 0, base);
          bytes += data.nextOffset;
          data.text.split("\n").forEach((line, i) => {
            if (
              matches.length < 100 &&
              line.toLowerCase().includes(p.query!.toLowerCase())
            )
              matches.push({ path, line: i + 1, text: line.slice(0, 300) });
          });
        }
      } catch {
        /* Unreadable, binary and outside-root entries are skipped. */
      }
    }
    return {
      matches,
      truncated:
        queue.length > 0 ||
        visited >= 1000 ||
        bytes >= 4000000 ||
        matches.length >= 100,
      note: "Search checks the first 32 KB of each regular text file, at most 1,000 paths and 4 MB.",
    };
  }
}
