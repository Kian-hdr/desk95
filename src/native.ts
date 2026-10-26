import JSZip from "jszip";
import {
  actions,
  db,
  getFailedMutations,
  getSnapshot,
  importBackup,
} from "./data";

export interface NativeSummary {
  activeWorkspaceId: string;
  workspaces: {
    id: string;
    title: string;
    projects: number;
    pages: number;
    tasks: number;
    revisions: number;
    attachments: number;
    attachmentBytes: number;
  }[];
  pendingDocuments: number;
  failedMutations: number;
}
export interface NativeAPI {
  prepareToClose(): Promise<{ ok: boolean; reason?: string }>;
  importBackup(
    base64: string,
  ): Promise<NativeSummary & { alreadyImported: boolean }>;
  exportBackup(): Promise<{ base64: string; name: string }>;
  inspect(): Promise<NativeSummary>;
}
declare global {
  interface Window {
    __DESK95_NATIVE__?: boolean;
    webkit?: {
      messageHandlers?: {
        desk95?: {
          postMessage(message: Record<string, unknown>): Promise<unknown>;
        };
      };
    };
    desk95Native?: NativeAPI;
  }
}
export const isNative = () =>
  typeof window !== "undefined" && window.__DESK95_NATIVE__ === true;
export async function nativeMessage(
  message: Record<string, unknown>,
): Promise<unknown> {
  const handler = window.webkit?.messageHandlers?.desk95;
  if (!isNative() || !handler)
    throw new Error("The native Desk95 bridge is unavailable.");
  return await handler.postMessage(message);
}
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function base64ToBlob(base64: string, mime = "application/zip"): Blob {
  if (typeof base64 !== "string" || base64.length > 280 * 1024 * 1024)
    throw new Error("The backup exceeds the supported size.");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
export class SaveCancelledError extends Error {
  constructor() {
    super("Export canceled.");
    this.name = "SaveCancelledError";
  }
}
export async function downloadFile(blob: Blob, name: string): Promise<void> {
  if (isNative()) {
    const response = (await nativeMessage({
      command: "saveFile",
      name,
      mime: blob.type || "application/octet-stream",
      base64: await blobToBase64(blob),
    })) as { saved?: boolean } | undefined;
    if (response?.saved === false) throw new SaveCancelledError();
    if (response?.saved !== true)
      throw new Error(
        "The native app did not confirm that the file was saved.",
      );
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function inspectNativeState(
  activeWorkspaceId: string,
  pendingDocuments = 0,
): Promise<NativeSummary> {
  const workspaces = await db.workspaces.toArray();
  return {
    activeWorkspaceId,
    pendingDocuments,
    failedMutations: getFailedMutations().length,
    workspaces: await Promise.all(
      workspaces.map(async (workspace) => {
        const s = await getSnapshot(workspace.id);
        return {
          id: workspace.id,
          title: workspace.title,
          projects: s.projects.length,
          pages: s.pages.length,
          tasks: s.tasks.length,
          revisions: s.revisions.length,
          attachments: s.attachments.length,
          attachmentBytes: s.attachments.reduce(
            (total, a) => total + a.size,
            0,
          ),
        };
      }),
    ),
  };
}
/** Receipt lives in the imported transaction, making retries after a crash idempotent. */
export async function importNativeBackup(
  base64: string,
): Promise<{ workspaceId: string; alreadyImported: boolean }> {
  const original = base64ToBlob(base64);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await original.arrayBuffer(),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const receiptKey = "nativeMigrationSource:" + hash;
  const receipt = await db.preferences
    .filter((p) => p.key === receiptKey && p.value === hash)
    .first();
  if (receipt && (await db.workspaces.get(receipt.workspaceId))) {
    await actions.selectWorkspace(receipt.workspaceId);
    return { workspaceId: receipt.workspaceId, alreadyImported: true };
  }
  const zip = await JSZip.loadAsync(await original.arrayBuffer());
  const manifest = zip.file("workspace.json");
  if (!manifest) throw new Error("Missing workspace manifest.");
  const content = await manifest.async("string");
  if (content.length > 30000000)
    throw new Error("Backup manifest is too large.");
  const backup = JSON.parse(content);
  if (
    backup?.format !== "desk95" ||
    backup.version !== 1 ||
    !backup.data?.workspace?.id ||
    !Array.isArray(backup.data.preferences)
  )
    throw new Error("Unsupported Desk95 backup.");
  backup.data.preferences.push({
    id: crypto.randomUUID(),
    workspaceId: backup.data.workspace.id,
    key: receiptKey,
    value: hash,
  });
  zip.file("workspace.json", JSON.stringify(backup));
  const workspaceId = await importBackup(
    await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    "separate",
  );
  return { workspaceId, alreadyImported: false };
}
