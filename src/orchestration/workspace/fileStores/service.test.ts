import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  FileStores,
  davRequest,
  connectionError,
  type DavTransport,
  type StoreConfig,
} from "./service.ts";
import { FileStoreRoutes } from "../../../surfaces/web/fileStoreRoutes.ts";
const input = {
  name: "Property",
  endpoint: "https://fileserver:5006",
  folders: [{ path: "/public/Property", writable: false }],
  username: "agent",
  password: "private-test-password",
};
const response = (
  status: number,
  body = "",
  headers: Record<string, string> = {},
) => ({ status, body: Buffer.from(body), headers });
function setup(
  transport: DavTransport = async () =>
    response(200, "document", { etag: '"version-a"' }),
) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE external_file_stores (id TEXT PRIMARY KEY, config TEXT NOT NULL)",
  );
  return { db, stores: new FileStores(db, transport) };
}
describe("external file stores", () => {
  test("secrets stay private; revision checks and disable take effect immediately", async () => {
    const { db, stores } = setup();
    try {
      const store = stores.save(input);
      expect(JSON.stringify(stores.list())).not.toContain(input.password);
      expect(() =>
        stores.save({ ...store, name: "Other", revision: 99 }),
      ).toThrow("connection changed");
      const disabled = stores.save({ ...store, enabled: false });
      await expect(
        stores.action({ action: "read", storeId: store.id, path: "notes.txt" }),
      ).rejects.toThrow("disabled");
      expect(() => stores.remove(store.id, store.revision)).toThrow(
        "connection changed",
      );
      stores.remove(store.id, disabled.revision);
      expect(stores.list()).toEqual([]);
    } finally {
      db.close();
    }
  });
  test("path escapes, encoded separators and unscoped roots are refused before network access", async () => {
    let calls = 0;
    const { db, stores } = setup(async () => {
      calls++;
      return response(200);
    });
    try {
      expect(() =>
        stores.save({ ...input, folders: [{ path: "/", writable: false }] }),
      ).toThrow("specific allowed folders");
      expect(() =>
        stores.save({ ...input, endpoint: "http://fileserver:5005" }),
      ).toThrow("HTTPS");
      const store = stores.save(input);
      for (const path of [
        "../outside",
        "x/../../outside",
        "%2e%2e/outside",
        "x\\outside",
      ])
        await expect(
          stores.action({ action: "read", storeId: store.id, path }),
        ).rejects.toThrow("inside");
      expect(calls).toBe(0);
    } finally {
      db.close();
    }
  });
  test("read-only grants block writes; replacement requires strong ETags; conflicts preserve the error", async () => {
    const calls: {
      method: string;
      headers: Record<string, string> | undefined;
    }[] = [];
    const { db, stores } = setup(async (_c, method, _p, headers) => {
      calls.push({ method, headers });
      return response(method === "PUT" ? 412 : 200);
    });
    try {
      let store = stores.save(input);
      await expect(
        stores.action({
          action: "write",
          storeId: store.id,
          path: "note.txt",
          content: "new",
          create: true,
        }),
      ).rejects.toThrow("disabled");
      store = stores.save({
        ...store,
        folders: store.folders.map((f) => ({ ...f, writable: true })),
      });
      for (const expectedEtag of [
        undefined,
        'W/"a"',
        "*",
        '"x"\r\nHeader: injected',
      ])
        await expect(
          stores.action({
            action: "write",
            storeId: store.id,
            path: "note.txt",
            content: "new",
            expectedEtag,
          }),
        ).rejects.toThrow("strong ETag");
      expect(calls).toHaveLength(0);
      await expect(
        stores.action({
          action: "write",
          storeId: store.id,
          path: "note.txt",
          content: "new",
          expectedEtag: '"old"',
        }),
      ).rejects.toThrow("file changed");
      expect(calls[0]!.headers?.["If-Match"]).toBe('"old"');
      await expect(
        stores.action({
          action: "write",
          storeId: store.id,
          path: "note.txt",
          content: "new",
          create: true,
        }),
      ).rejects.toThrow("already exists");
      expect(calls[1]!.headers?.["If-None-Match"]).toBe("*");
    } finally {
      db.close();
    }
  });
  test("folder listings filter outside-root hrefs and reject XML declarations", async () => {
    let xml =
      '<d:multistatus xmlns:d="DAV:">' +
      [
        "/public/Property/",
        "/public/Property/note.txt",
        "/public/Other/leak.txt",
      ]
        .map(
          (h) =>
            `<d:response><d:href>${h}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:resourcetype/><d:getcontentlength>4</d:getcontentlength></d:prop></d:propstat></d:response>`,
        )
        .join("") +
      "</d:multistatus>";
    const { db, stores } = setup(async () => response(207, xml));
    try {
      const store = stores.save(input);
      const result = (await stores.action({
        action: "list",
        storeId: store.id,
      })) as { entries: { path: string }[] };
      expect(result.entries.map((e) => e.path)).toEqual(["note.txt"]);
      xml = "<!DOCTYPE unsafe><d:multistatus/>";
      await expect(
        stores.action({ action: "list", storeId: store.id }),
      ).rejects.toThrow("XML declarations");
    } finally {
      db.close();
    }
  });
  test("binary files require explicit download; uncached reads always reach the NAS", async () => {
    let calls = 0;
    const { db, stores } = setup(async () => {
      calls++;
      return response(200, "%PDF-test", { etag: 'W/"recent"' });
    });
    try {
      const store = stores.save(input);
      await expect(
        stores.action({ action: "read", storeId: store.id, path: "doc.pdf" }),
      ).rejects.toThrow("binary document");
      const result = (await stores.action({
        action: "download",
        storeId: store.id,
        path: "doc.pdf",
      })) as { base64: string };
      expect(Buffer.from(result.base64, "base64").toString()).toBe("%PDF-test");
      expect(calls).toBe(2);
    } finally {
      db.close();
    }
  });
  test("owner HTTP API returns no secrets and uses no-store responses", async () => {
    const { db, stores } = setup();
    try {
      const routes = new FileStoreRoutes(stores);
      stores.save(input);
      const res = await routes.handle(
        new Request("https://agent/api/file-stores"),
        "/api/file-stores",
      );
      expect(res!.headers.get("cache-control")).toBe("no-store");
      expect(await res!.text()).not.toContain(input.password);
    } finally {
      db.close();
    }
  });
  test("pinned TLS checks identity before transmitting authorization", async () => {
    const dir = mkdtempSync(join(tmpdir(), "file-store-tls-"));
    let received = 0;
    try {
      const cert = join(dir, "cert.pem"),
        key = join(dir, "key.pem");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-keyout",
          key,
          "-out",
          cert,
        ],
        { stdio: "ignore" },
      );
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        tls: { cert: readFileSync(cert), key: readFileSync(key) },
        fetch() {
          received++;
          return new Response("ok");
        },
      });
      try {
        const config = {
          ...input,
          folders: input.folders.map((f) => ({
            ...f,
            id: crypto.randomUUID(),
          })),
          id: crypto.randomUUID(),
          revision: 1,
          enabled: true,
          endpoint: `https://127.0.0.1:${server.port}`,
          certificateSha256: "0".repeat(64),
        } satisfies StoreConfig;
        await expect(
          davRequest(config, "GET", "/public/Property/test"),
        ).rejects.toThrow("certificate");
        expect(received).toBe(0);
        config.certificateSha256 = "";
        await expect(
          davRequest(config, "GET", "/public/Property/test"),
        ).rejects.toThrow("self-signed");
        expect(received).toBe(0);
        config.certificateSha256 = createHash("sha256")
          .update(new X509Certificate(readFileSync(cert)).raw)
          .digest("hex");
        const res = await davRequest(config, "GET", "/public/Property/test");
        expect(res.status).toBe(200);
        expect(received).toBe(1);
      } finally {
        server.stop(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

test("one connection supports several folders with independent write grants", async () => {
  const paths: string[] = [];
  const { db, stores } = setup(async (_config, _method, path) => {
    paths.push(path);
    return response(201);
  });
  try {
    const store = stores.save({
      ...input,
      folders: [
        { path: "/public/Property", writable: true },
        { path: "/public/Reference", writable: false },
      ],
    });
    await expect(
      stores.action({ action: "read", storeId: store.id, path: "file.txt" }),
    ).rejects.toThrow("folderId");
    await expect(
      stores.action({
        action: "write",
        storeId: store.id,
        folderId: store.folders[1]!.id,
        path: "file.txt",
        content: "hello",
        create: true,
      }),
    ).rejects.toThrow("disabled for this folder");
    expect(paths).toEqual([]);
    await stores.action({
      action: "write",
      storeId: store.id,
      folderId: store.folders[0]!.id,
      path: "file.txt",
      content: "hello",
      create: true,
    });
    expect(paths).toEqual(["/public/Property/file.txt"]);
    const updated = stores.save({ ...store, folders: [store.folders[1]!] });
    await expect(
      stores.action({
        action: "read",
        storeId: updated.id,
        folderId: store.folders[0]!.id,
        path: "file.txt",
      }),
    ).rejects.toThrow("folderId");
  } finally {
    db.close();
  }
});

test("connection diagnostics distinguish causes without leaking raw errors", () => {
  for (const [code, text] of [
    ["ENOTFOUND", "resolved"],
    ["ECONNREFUSED", "refused"],
    ["ETIMEDOUT", "timed out"],
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "does not match"],
  ]) {
    const error = connectionError(
      Object.assign(new Error("Authorization: secret"), { code }),
      "PROPFIND",
    );
    expect(error.message).toContain(text!);
    expect(error.message).toContain(code!);
    expect(error.message).not.toContain("secret");
    expect(error.message).not.toContain("write");
  }
  expect(
    connectionError({ cause: { code: "ECONNREFUSED" } }, "PUT").message,
  ).toContain("before retrying the write");
  expect(
    connectionError(new Error("password=secret"), "GET").message,
  ).not.toContain("secret");
});

test("connection checks distinguish rejected login, permission and missing folder", async () => {
  for (const [code, message] of [
    [401, "login"],
    [403, "denied access"],
    [404, "folder path"],
  ] as const) {
    const { db, stores } = setup(async () => response(code));
    try {
      const result = await stores.check(stores.save(input).id);
      expect(result.ok).toBe(false);
      expect(result.folders[0]?.message).toContain(message);
      expect(result.folders[0]?.message).toContain(`HTTP ${code}`);
    } finally {
      db.close();
    }
  }
});
