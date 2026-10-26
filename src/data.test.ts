import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import {
  actions,
  claimEditor,
  db,
  DeskDatabase,
  establishTabOwner,
  exportBackup,
  getSnapshot,
  getFailedMutations,
  heartbeatEditor,
  importBackup,
  initialize,
  retryFailedMutations,
  textDoc,
} from "./data";

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await claimEditor(true);
  await retryFailedMutations();
  await db.delete();
});
describe("local workspace storage", () => {
  it("creates the example only once, including after deleting it", async () => {
    const id = await initialize();
    const first = await getSnapshot(id);
    expect(first.tasks).toHaveLength(5);
    await actions.trash("project", first.projects[0].id);
    await actions.emptyTrash(id);
    expect(await initialize()).toBe(id);
    expect((await getSnapshot(id)).projects).toHaveLength(0);
  });
  it("serializes document saves and rejects circular nesting", async () => {
    const id = await initialize();
    const p = await actions.createPage(id, { title: "Parent" });
    const child = await actions.createPage(id, { parentId: p.id });
    await expect(actions.movePage(p.id, child.id)).rejects.toThrow(
      "descendants",
    );
    await Promise.all([
      actions.savePage(p.id, textDoc("first"), "first"),
      actions.savePage(p.id, textDoc("second"), "second"),
    ]);
    expect((await db.pages.get(p.id))?.text).toBe("second");
    expect(await db.revisions.where("pageId").equals(p.id).count()).toBe(1);
  });
  it("preserves a pre-restore revision and recovers deleted pages", async () => {
    const id = await initialize();
    const p = await actions.createPage(id, {
      text: "original",
      content: textDoc("original"),
    });
    await actions.savePage(p.id, textDoc("changed"), "changed");
    const r = (await db.revisions.where("pageId").equals(p.id).toArray())[0];
    await actions.restoreRevision(r.id);
    expect((await db.pages.get(p.id))?.text).toBe("original");
    await actions.trash("page", p.id);
    expect((await db.pages.get(p.id))?.deletedAt).toBeTruthy();
    await actions.restore("page", p.id);
    expect((await db.pages.get(p.id))?.deletedAt).toBeUndefined();
  });
  it("enforces editing ownership inside every transaction", async () => {
    const id = await initialize();
    await db.leases.put({
      id: "editor",
      owner: "other-tab",
      expires: Date.now() + 15000,
    });
    await expect(actions.createTask(id)).rejects.toThrow("read-only");
    expect(await claimEditor()).toBe(false);
    expect(await claimEditor(true)).toBe(true);
    await retryFailedMutations();
    await expect(actions.createTask(id)).resolves.toHaveProperty("title");
  });
  it("reclaims expired ownership through heartbeat without taking an active lease", async () => {
    await initialize();
    await db.leases.put({
      id: "editor",
      owner: "other-tab",
      expires: Date.now() + 15000,
    });
    expect(await heartbeatEditor()).toBe(false);
    await db.leases.put({
      id: "editor",
      owner: "other-tab",
      expires: Date.now() - 1,
    });
    expect(await heartbeatEditor()).toBe(true);
  });
  it("keeps tab identity on reload and isolates duplicated session storage", async () => {
    const held = new Set<string>();
    const locks = {
      request: (
        name: string,
        _options: unknown,
        callback: (lock: unknown) => Promise<void>,
      ) => callback(held.has(name) ? null : (held.add(name), { name })),
    } as unknown as Pick<LockManager, "request">;
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    const first = await establishTabOwner(storage, locks);
    const clonedValue = value;
    const duplicateStorage = { getItem: () => clonedValue, setItem: () => {} };
    expect(await establishTabOwner(duplicateStorage, locks)).not.toBe(first);
    held.delete("Desk95-tab-" + first);
    expect(await establishTabOwner(storage, locks)).toBe(first);
  });
  it("round-trips links and attachment bytes into a separate workspace", async () => {
    const id = await initialize();
    const p = await actions.createPage(id, { title: "With attachment" });
    await actions.createTask(id, { title: "Linked task", pageIds: [p.id] });
    await actions.addAttachment(
      id,
      p.id,
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );
    const exported = await exportBackup(id);
    const target = await importBackup(exported, "separate");
    const s = await getSnapshot(target);
    const copied = s.pages.find((x) => x.title === "With attachment")!;
    expect(target).not.toBe(id);
    expect(copied.id).not.toBe(p.id);
    expect(s.tasks.find((t) => t.title === "Linked task")?.pageIds).toEqual([
      copied.id,
    ]);
    expect(await s.attachments[0].blob.text()).toBe("hello");
    expect(s.attachments[0].pageId).toBe(copied.id);
  });
  it("rejects malformed imports without changing the existing workspace", async () => {
    const id = await initialize();
    const before = await getSnapshot(id);
    const zip = new JSZip();
    zip.file(
      "workspace.json",
      JSON.stringify({
        format: "desk95",
        version: 1,
        data: { ...before, tasks: [{ ...before.tasks[0], status: "unknown" }] },
      }),
    );
    await expect(
      importBackup(await zip.generateAsync({ type: "blob" }), "replace", id),
    ).rejects.toThrow("Invalid task");
    expect((await getSnapshot(id)).tasks).toEqual(before.tasks);
  });
  it("remaps editor attachment references and internal links in copies and backups", async () => {
    const id = await initialize();
    const p = await actions.createPage(id);
    const a = await actions.addAttachment(
      id,
      p.id,
      new File(["data"], "a.txt"),
    );
    await actions.savePage(
      p.id,
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { attachmentId: a.id, src: "/__attachment/" + a.id },
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Link",
                marks: [{ type: "link", attrs: { href: "#/page/" + p.id } }],
              },
            ],
          },
        ],
      },
      "Link",
    );
    const copy = await actions.duplicatePage(p.id);
    const copyAttachment = (
      await db.attachments.where("pageId").equals(copy.id).toArray()
    )[0];
    expect(copy.content.content![0].attrs.attachmentId).toBe(copyAttachment.id);
    const restored = await importBackup(await exportBackup(id), "separate");
    const s = await getSnapshot(restored);
    const restoredPage = s.pages.find(
      (x) =>
        x.id !== copy.id && x.title === p.title && !x.title.endsWith("(copy)"),
    )!;
    const restoredAttachment = s.attachments.find(
      (x) => x.pageId === restoredPage.id,
    )!;
    expect(restoredPage.content.content![0].attrs.attachmentId).toBe(
      restoredAttachment.id,
    );
    expect(
      restoredPage.content.content![1].content[0].marks[0].attrs.href,
    ).toBe("#/page/" + restoredPage.id);
  });
  it("bounds history to twenty checkpoints and retains a pre-delete checkpoint", async () => {
    const id = await initialize();
    const p = await actions.createPage(id);
    for (let i = 0; i < 25; i++) {
      await db.revisions
        .where("pageId")
        .equals(p.id)
        .modify((r) => {
          r.createdAt -= 61000;
        });
      await actions.savePage(p.id, textDoc(String(i)), String(i));
    }
    expect(await db.revisions.where("pageId").equals(p.id).count()).toBe(20);
    await actions.trash("page", p.id);
    const r = await db.revisions.where("pageId").equals(p.id).toArray();
    expect(r).toHaveLength(20);
    expect(r.some((x) => x.text === "24")).toBe(true);
  });
  it("keeps backups restorable after permanently deleting a project overview", async () => {
    const id = await initialize();
    const p = (await getSnapshot(id)).projects[0];
    await actions.trash("page", p.overviewPageId!);
    await actions.emptyTrash(id);
    expect((await db.projects.get(p.id))?.overviewPageId).toBeUndefined();
    await expect(
      importBackup(await exportBackup(id), "separate"),
    ).resolves.toBeTypeOf("string");
  });
  it("preserves literal identifiers in document text and descriptive attributes", async () => {
    const id = await initialize();
    const p = await actions.createPage(id);
    await actions.savePage(
      p.id,
      {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: p.id }] },
          {
            type: "image",
            attrs: {
              src: "https://example.com/test.png",
              alt: p.id,
              title: p.id,
            },
          },
        ],
      },
      p.id,
    );
    const target = await importBackup(await exportBackup(id), "separate");
    const restored = (await getSnapshot(target)).pages.find(
      (x) => x.text === p.id,
    )!;
    expect(restored.content.content![0].content[0].text).toBe(p.id);
    expect(restored.content.content![1].attrs.alt).toBe(p.id);
    expect(restored.content.content![1].attrs.title).toBe(p.id);
  });
  it("rejects malformed documents and preference types before replacing data", async () => {
    const id = await initialize();
    const before = await getSnapshot(id);
    for (const mutate of [
      (s: typeof before) => {
        s.pages[0].content = { type: "unknown" };
      },
      (s: typeof before) => {
        s.pages[0].content = {
          type: "doc",
          content: [{ type: "paragraph", marks: {} }],
        };
      },
      (s: typeof before) => {
        s.preferences = [
          { id: "bad", workspaceId: id, key: "recent", value: {} },
        ];
      },
      (s: typeof before) => {
        s.tasks[0].dueDate = "2026-02-31";
      },
      (s: typeof before) => {
        s.tasks[0].order = Infinity;
      },
    ]) {
      const data = structuredClone(before);
      mutate(data);
      const zip = new JSZip();
      zip.file(
        "workspace.json",
        JSON.stringify({ format: "desk95", version: 1, data }),
      );
      await expect(
        importBackup(await zip.generateAsync({ type: "blob" }), "replace", id),
      ).rejects.toThrow();
      expect((await getSnapshot(id)).pages).toEqual(before.pages);
    }
  });
  it("strips executable URLs and unrecognized attributes from imported content", async () => {
    const id = await initialize();
    const s = await getSnapshot(id);
    s.attachments = [];
    s.pages[0].content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)" },
          content: [
            {
              type: "text",
              text: "Click",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    const zip = new JSZip();
    zip.file(
      "workspace.json",
      JSON.stringify({ format: "desk95", version: 1, data: s }),
    );
    const target = await importBackup(
      await zip.generateAsync({ type: "blob" }),
      "separate",
    );
    const p = (await getSnapshot(target)).pages.find(
      (p) => p.title === s.pages[0].title,
    )!;
    expect(p.content.content![0].attrs).toBeUndefined();
    expect(p.content.content![0].content[0].marks || []).toEqual([]);
  });
  it("retains failed metadata mutations, blocks new changes, and retries in original order", async () => {
    const id = await initialize();
    const t = await actions.createTask(id);
    const spy = vi
      .spyOn(db.tasks, "update")
      .mockRejectedValue(
        new DOMException("Full storage", "QuotaExceededError"),
      );
    await Promise.allSettled([
      actions.updateTask(t.id, { title: "First" }),
      actions.updateTask(t.id, { title: "Second" }),
    ]);
    expect(
      getFailedMutations().map(
        (intent) => (intent.args[1] as { title: string }).title,
      ),
    ).toEqual(["First", "Second"]);
    expect(JSON.parse(JSON.stringify(getFailedMutations()))).toHaveLength(2);
    await expect(actions.createPage(id)).rejects.toThrow("Retry pending saves");
    await expect(retryFailedMutations()).rejects.toThrow("Full storage");
    expect(getFailedMutations()).toHaveLength(2);
    spy.mockRestore();
    await retryFailedMutations();
    expect(getFailedMutations()).toEqual([]);
    expect((await db.tasks.get(t.id))?.title).toBe("Second");
    await expect(actions.createPage(id)).resolves.toHaveProperty("id");
  });
  it("leaves document failures with the application pending queue and validation errors unqueued", async () => {
    const id = await initialize();
    const p = await actions.createPage(id);
    const child = await actions.createPage(id, { parentId: p.id });
    await expect(actions.movePage(p.id, child.id)).rejects.toThrow(
      "descendants",
    );
    expect(getFailedMutations()).toEqual([]);
    const spy = vi
      .spyOn(db.pages, "update")
      .mockRejectedValueOnce(
        new DOMException("Full storage", "QuotaExceededError"),
      );
    await expect(
      actions.savePage(p.id, textDoc("pending"), "pending"),
    ).rejects.toThrow();
    expect(getFailedMutations()).toEqual([]);
    spy.mockRestore();
    await actions.savePage(p.id, textDoc("pending"), "pending");
  });
  it("remembers the selected or imported workspace across initialization", async () => {
    const first = await initialize();
    const imported = await importBackup(await exportBackup(first), "separate");
    expect(await initialize()).toBe(imported);
    await actions.selectWorkspace(first);
    expect(await initialize()).toBe(first);
    await actions.selectWorkspace(imported);
    expect(await initialize()).toBe(imported);
  });
  it("upgrades a populated version-one database without losing data", async () => {
    const name = "Desk95-migration-test";
    const old = new DeskDatabase(name);
    await old.delete();
    // Open the original schema with a plain Dexie instance.
    const { default: Dexie } = await import("dexie");
    const v1 = new Dexie(name);
    v1.version(1).stores({
      workspaces: "id",
      projects: "id,workspaceId",
      pages: "id,workspaceId,parentId,projectId",
      tasks: "id,workspaceId,projectId,status",
      attachments: "id,workspaceId,pageId",
      revisions: "id,workspaceId,pageId",
      preferences: "id,workspaceId",
      leases: "id",
    });
    await v1
      .table("workspaces")
      .add({ id: "saved", title: "Kept", createdAt: 1, updatedAt: 1 });
    v1.close();
    await old.open();
    expect((await old.workspaces.get("saved"))?.title).toBe("Kept");
    await old.delete();
  });
});
