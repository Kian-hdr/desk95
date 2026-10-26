import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actions,
  claimEditor,
  db,
  exportBackup,
  getFailedMutations,
  initialize,
  retryFailedMutations,
  textDoc,
} from "./data";
import {
  base64ToBlob,
  blobToBase64,
  downloadFile,
  importNativeBackup,
  inspectNativeState,
  SaveCancelledError,
} from "./native";

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await claimEditor(true);
  if (getFailedMutations().length) await retryFailedMutations();
  await db.delete();
});
describe("native shell bridge", () => {
  it("round-trips arbitrary backup bytes without character encoding loss", async () => {
    const original = new Uint8Array([0, 255, 128, 12, 42]);
    expect(
      new Uint8Array(
        await base64ToBlob(
          await blobToBase64(new Blob([original])),
        ).arrayBuffer(),
      ),
    ).toEqual(original);
  });
  it("requires a confirmed native save and distinguishes canceled panels", async () => {
    const postMessage = vi
      .fn()
      .mockResolvedValueOnce({ saved: true })
      .mockResolvedValueOnce({ saved: false })
      .mockResolvedValueOnce({});
    vi.stubGlobal("window", {
      __DESK95_NATIVE__: true,
      webkit: { messageHandlers: { desk95: { postMessage } } },
    });
    await downloadFile(
      new Blob(["hello"], { type: "text/plain" }),
      "hello.txt",
    );
    expect(postMessage).toHaveBeenCalledWith({
      command: "saveFile",
      name: "hello.txt",
      mime: "text/plain",
      base64: btoa("hello"),
    });
    await expect(
      downloadFile(new Blob(["hello"]), "hello.txt"),
    ).rejects.toBeInstanceOf(SaveCancelledError);
    await expect(
      downloadFile(new Blob(["hello"]), "hello.txt"),
    ).rejects.toThrow("did not confirm");
  });
  it("imports browser data once with attachments and preserves original workspace", async () => {
    const source = await initialize();
    const page = await actions.createPage(source, {
      title: "Browser brief",
      content: textDoc("Keep this exact text"),
      text: "Keep this exact text",
    });
    await actions.addAttachment(
      source,
      page.id,
      new File(["original bytes"], "evidence.txt", { type: "text/plain" }),
    );
    const backup = await blobToBase64(await exportBackup(source));
    const first = await importNativeBackup(backup);
    expect(first.alreadyImported).toBe(false);
    expect(first.workspaceId).not.toBe(source);
    const again = await importNativeBackup(backup);
    expect(again).toEqual({ ...first, alreadyImported: true });
    expect(await db.workspaces.count()).toBe(2);
    expect((await db.pages.get(page.id))?.text).toBe("Keep this exact text");
    const summary = await inspectNativeState(first.workspaceId);
    const restored = summary.workspaces.find(
      (w) => w.id === first.workspaceId,
    )!;
    expect(restored.attachments).toBe(1);
    expect(restored.attachmentBytes).toBe(14);
    expect(await initialize()).toBe(first.workspaceId);
  });
  it("rejects invalid migration data without committing a receipt or workspace", async () => {
    await initialize();
    await expect(
      importNativeBackup(await blobToBase64(new Blob(["invalid ZIP"]))),
    ).rejects.toThrow();
    expect(await db.workspaces.count()).toBe(1);
    expect(
      await db.preferences
        .filter((p) => p.key.startsWith("nativeMigrationSource:"))
        .count(),
    ).toBe(0);
  });
});
