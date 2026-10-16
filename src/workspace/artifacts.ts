import { lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, fstatSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { artifactDocument, artifactId, artifactReadParams } from "../orchestration/artifactContracts.ts";
import { writeFileAtomic } from "./files.ts";
import { SAFE_OPEN } from "./runReader.ts";

/** Owner documents live outside chat sessions, and survive session rotation. */
export class ArtifactStore {
  private readonly directory: string;
  constructor(stateDir: string) { this.directory = join(stateDir, "artifacts"); }
  private root(): string {
    mkdirSync(this.directory, { recursive: true });
    if (lstatSync(this.directory).isSymbolicLink()) throw new Error("Artifact directory cannot be a symlink");
    return realpathSync(this.directory);
  }
  get(id: string) {
    artifactId.parse(id);
    const path = join(this.root(), `${id}.json`);
    let fd: number;
    try { fd = openSync(path, SAFE_OPEN); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024) throw new Error("Invalid artifact file");
      const document = artifactDocument.parse(JSON.parse(readFileSync(fd, "utf8")));
      if (document.id !== id) throw new Error("Artifact identity mismatch");
      return document;
    } finally { closeSync(fd); }
  }
  list(query = "") {
    const files = readdirSync(this.root()).filter(name => name.endsWith(".json") && artifactId.safeParse(name.slice(0, -5)).success);
    const documents = files.slice(0, 2000).map(name => this.get(name.slice(0, -5))).filter(doc => doc !== null);
    const needle = query.toLocaleLowerCase();
    return {
      artifacts: documents.filter(doc => `${doc.title}\n${doc.content}`.toLocaleLowerCase().includes(needle))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ content: _, ...summary }) => summary),
      truncated: files.length > 2000,
    };
  }
  save(input: { id?: string; title: string; content: string }, conversationId: string) {
    if (Buffer.byteLength(input.content, "utf8") > 256 * 1024) throw new Error("Document exceeds 256 KiB");
    const previous = input.id ? this.get(input.id) : null;
    if (input.id && !previous) throw new Error("Artifact not found; omit id to create a document");
    const now = new Date().toISOString();
    const document = artifactDocument.parse({ ...input, title: input.title.replace(/[\r\n]/g, " ").trim(), id: previous?.id ?? randomUUID(),
      createdAt: previous?.createdAt ?? now, updatedAt: now, conversationId: previous?.conversationId ?? conversationId, version: (previous?.version ?? 0) + 1 });
    writeFileAtomic(join(this.root(), `${document.id}.json`), JSON.stringify(document));
    return document;
  }
  extension(conversationId: string): ExtensionFactory {
    return pi => {
      pi.registerTool({
        name: "save_artifact", label: "Save document",
        description: "Create a persisted Markdown document for reports, research, plans and other substantial deliverables. Supply an existing id to update it at the same link. Return the provided Markdown link in your reply so the owner can open the document card. Documents are searchable in the Artifacts library and survive new chat sessions.",
        parameters: Type.Object({ id: Type.Optional(Type.String()), title: Type.String({ minLength: 1, maxLength: 200 }), content: Type.String({ maxLength: 256 * 1024 }) }),
        execute: async (_id, input) => {
          const doc = this.save(input, conversationId);
          return { content: [{ type: "text", text: JSON.stringify({ id: doc.id, version: doc.version, link: `[${doc.title.replace(/[\[\]\\]/g, "")}](/artifacts/${doc.id})` }) }], details: {} };
        },
      });
      pi.registerTool({
        name: "find_artifacts", label: "Find documents",
        description: "Search saved documents by title or content, or read a full document by id before updating it.",
        parameters: Type.Object({ id: Type.Optional(Type.String()), query: Type.Optional(Type.String({ maxLength: 200 })) }),
        execute: async (_id, input) => ({ content: [{ type: "text", text: JSON.stringify(input.id ? this.get(input.id) : this.list(input.query)) }], details: {} }),
      });
    };
  }
  handlers(principalId: string) {
    return { "artifacts/read": async (raw: unknown) => {
      const params = artifactReadParams.parse(raw);
      if (params.principalId !== principalId) throw new Error("wrong principal");
      return params.id ? this.get(params.id) : this.list(params.query);
    } };
  }
}
export const ARTIFACT_TOOLS = ["save_artifact", "find_artifacts"];
