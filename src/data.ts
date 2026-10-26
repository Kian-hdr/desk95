import Dexie, { type Table } from "dexie";
import JSZip from "jszip";
import type {
  Attachment,
  Doc,
  Kind,
  Page,
  Preference,
  Project,
  Revision,
  Snapshot,
  Task,
  Workspace,
} from "./types";
import { sanitizeContent } from "./editor-utils";

interface Lease {
  id: string;
  owner: string;
  expires: number;
}
export class DeskDatabase extends Dexie {
  workspaces!: Table<Workspace>;
  projects!: Table<Project>;
  pages!: Table<Page>;
  tasks!: Table<Task>;
  attachments!: Table<Attachment>;
  revisions!: Table<Revision>;
  preferences!: Table<Preference>;
  leases!: Table<Lease>;
  constructor(name = "Desk95") {
    super(name);
    this.version(1).stores({
      workspaces: "id",
      projects: "id,workspaceId",
      pages: "id,workspaceId,parentId,projectId",
      tasks: "id,workspaceId,projectId,status",
      attachments: "id,workspaceId,pageId",
      revisions: "id,workspaceId,pageId",
      preferences: "id,workspaceId",
      leases: "id",
    });
    this.version(2).stores({
      pages: "id,workspaceId,parentId,projectId,updatedAt",
      tasks: "id,workspaceId,projectId,status,updatedAt",
    });
  }
}
export const db = new DeskDatabase();
let owner: string = crypto.randomUUID();
let ownerReady: Promise<void> | undefined;
/** A lifetime Web Lock distinguishes a reloaded tab from a duplicated tab whose
 * sessionStorage was cloned. Browsers release the lock with the old document. */
export async function establishTabOwner(
  storage?: Pick<Storage, "getItem" | "setItem">,
  locks?: Pick<LockManager, "request">,
): Promise<string> {
  if (!storage || !locks) return crypto.randomUUID();
  let candidate: string;
  try {
    candidate = storage.getItem("desk95-tab-owner") || crypto.randomUUID();
  } catch {
    return crypto.randomUUID();
  }
  const hold = (token: string) =>
    new Promise<boolean>((resolve) => {
      void locks
        .request("Desk95-tab-" + token, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          // Pending until this document is destroyed; do not release on React cleanup.
          await new Promise<void>(() => {});
        })
        .catch(() => resolve(false));
    });
  if (!(await hold(candidate))) {
    candidate = crypto.randomUUID();
    if (!(await hold(candidate))) return crypto.randomUUID();
  }
  try {
    storage.setItem("desk95-tab-owner", candidate);
  } catch {
    /* The lock still guarantees this document's identity. */
  }
  return candidate;
}
function prepareOwner() {
  return (ownerReady ??= (async () => {
    let storage: Storage | undefined;
    try {
      storage =
        typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    } catch {
      /* Storage disabled. */
    }
    owner = await establishTabOwner(
      storage,
      typeof navigator === "undefined" ? undefined : navigator.locks,
    );
  })());
}
const LEASE_MS = 15000;
let editing = false;
const uid = () => crypto.randomUUID();
export const emptyDoc = (): Doc => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
export const textDoc = (text: string): Doc => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : undefined },
  ],
});
export const isEditor = () => editing;
export async function claimEditor(takeover = false) {
  await prepareOwner();
  editing = await db.transaction("rw", db.leases, async () => {
    const lease = await db.leases.get("editor");
    if (
      !takeover &&
      lease &&
      lease.owner !== owner &&
      lease.expires > Date.now()
    )
      return false;
    await db.leases.put({
      id: "editor",
      owner,
      expires: Date.now() + LEASE_MS,
    });
    return true;
  });
  return editing;
}
export async function heartbeatEditor() {
  await prepareOwner();
  editing = await db.transaction("rw", db.leases, async () => {
    const lease = await db.leases.get("editor");
    if (lease && lease.owner !== owner && lease.expires > Date.now())
      return false;
    await db.leases.put({
      id: "editor",
      owner,
      expires: Date.now() + LEASE_MS,
    });
    return true;
  });
  return editing;
}
export async function releaseEditor() {
  await db.transaction("rw", db.leases, async () => {
    if ((await db.leases.get("editor"))?.owner === owner)
      await db.leases.delete("editor");
  });
  editing = false;
}
async function assertOwner() {
  const lease = await db.leases.get("editor");
  if (lease?.owner !== owner || lease.expires <= Date.now()) {
    editing = false;
    throw new Error(
      "This tab is read-only. Take over editing to save changes.",
    );
  }
}
async function write<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction(
    "rw",
    [
      db.leases,
      db.workspaces,
      db.projects,
      db.pages,
      db.tasks,
      db.attachments,
      db.revisions,
      db.preferences,
    ],
    async () => {
      await assertOwner();
      return fn();
    },
  );
}
export async function initialize() {
  await claimEditor();
  const existing = await db.workspaces.toArray();
  if (existing.length) {
    const active = await db.preferences.get("application:activeWorkspace");
    return (
      existing.find((workspace) => workspace.id === active?.value)?.id ??
      existing[0].id
    );
  }
  if (!editing) {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const first = await db.workspaces.toCollection().first();
      if (first) return first.id;
    }
    throw new Error(
      "The editing tab is preparing this workspace. Reload in a moment.",
    );
  }
  return write(async () => {
    const first = await db.workspaces.toCollection().first();
    if (first) return first.id;
    const id = uid(),
      now = Date.now(),
      projectId = uid(),
      pageId = uid();
    await db.workspaces.add({
      id,
      title: "My workspace",
      createdAt: now,
      updatedAt: now,
    });
    await db.projects.add({
      id: projectId,
      workspaceId: id,
      title: "Example: Personal workspace",
      description:
        "A little room for big ideas. A removable example to help you get started.",
      overviewPageId: pageId,
      createdAt: now,
      updatedAt: now,
    });
    const text =
      "Welcome to your local workspace. Write a brief, create linked tasks, and export a backup from the File menu. This example is yours to edit or delete.";
    await db.pages.add({
      id: pageId,
      workspaceId: id,
      projectId,
      title: "Start here · Example",
      content: textDoc(text),
      text,
      favorite: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const [i, title] of [
      "Make yourself at home",
      "Write down a big idea",
      "Turn your brief into a task",
      "Try the dark side",
      "Export your first backup",
    ].entries())
      await db.tasks.add({
        id: uid(),
        workspaceId: id,
        projectId,
        title,
        description: textDoc(
          "Example task: edit this, move it, or delete it. Your changes stay on this device.",
        ),
        text: "Example task: edit this, move it, or delete it. Your changes stay on this device.",
        status: (["Done", "In progress", "To do", "Backlog", "To do"] as const)[
          i
        ]!,
        priority: i === 4 ? "High" : "Medium",
        labels: ["Example"],
        pageIds: i === 2 ? [pageId] : [],
        subtasks: [],
        order: i,
        createdAt: now,
        updatedAt: now,
      });
    return id;
  });
}
export async function getSnapshot(workspaceId: string): Promise<Snapshot> {
  return db.transaction(
    "r",
    [
      db.workspaces,
      db.projects,
      db.pages,
      db.tasks,
      db.attachments,
      db.revisions,
      db.preferences,
    ],
    async () => {
      const workspace = await db.workspaces.get(workspaceId);
      if (!workspace) throw new Error("Workspace not found.");
      const [projects, pages, tasks, attachments, revisions, preferences] =
        await Promise.all(
          [
            db.projects,
            db.pages,
            db.tasks,
            db.attachments,
            db.revisions,
            db.preferences,
          ].map((t) => t.where("workspaceId").equals(workspaceId).toArray()),
        );
      return {
        workspace,
        projects,
        pages,
        tasks,
        attachments,
        revisions,
        preferences,
      } as Snapshot;
    },
  );
}
function base(workspaceId: string, title: string) {
  const now = Date.now();
  return { id: uid(), workspaceId, title, createdAt: now, updatedAt: now };
}
function remapDoc(doc: Doc, ids: Map<string, string>): Doc {
  const attrs = (input: Record<string, unknown> | undefined) => {
    if (!input) return input;
    const out = { ...input };
    if (typeof out.attachmentId === "string")
      out.attachmentId = ids.get(out.attachmentId) ?? out.attachmentId;
    for (const key of ["href", "src"])
      if (typeof out[key] === "string")
        out[key] = (out[key] as string).replace(
          /^(#\/page\/|#\/attachment\/|\/__attachment\/)([^/?#]+)$/,
          (_match, prefix, id) => prefix + (ids.get(id) ?? id),
        );
    return out;
  };
  return {
    ...doc,
    attrs: attrs(doc.attrs),
    marks: doc.marks?.map((mark) => ({ ...mark, attrs: attrs(mark.attrs) })),
    content: doc.content?.map((node) => remapDoc(node, ids)),
  };
}
async function revision(page: Page, force = false) {
  const previous = (
    await db.revisions.where("pageId").equals(page.id).toArray()
  ).sort((a, b) => b.createdAt - a.createdAt);
  if (!force && previous.length && Date.now() - previous[0].createdAt < 60000)
    return;
  await db.revisions.add({
    id: uid(),
    workspaceId: page.workspaceId,
    pageId: page.id,
    title: page.title,
    content: page.content,
    text: page.text,
    createdAt: Date.now(),
  });
  await db.revisions.bulkDelete(previous.slice(19).map((r) => r.id));
}
async function checkParent(
  pageId: string,
  workspaceId: string,
  parentId?: string,
) {
  const seen = new Set([pageId]);
  let next = parentId;
  while (next) {
    if (seen.has(next))
      throw new Error(
        "A page cannot be nested inside itself or one of its descendants.",
      );
    seen.add(next);
    const p = await db.pages.get(next);
    if (!p || p.workspaceId !== workspaceId || p.deletedAt)
      throw new Error("Choose an existing page in this workspace.");
    next = p.parentId;
  }
}
let pageQueue: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = pageQueue.catch(() => undefined).then(fn);
  pageQueue = next;
  return next;
}
const table = (kind: Kind) =>
  kind === "page" ? db.pages : kind === "task" ? db.tasks : db.projects;
const rawActions = {
  selectWorkspace: (id: string) =>
    write(async () => {
      if (!(await db.workspaces.get(id)))
        throw new Error("Workspace not found.");
      await db.preferences.put({
        id: "application:activeWorkspace",
        workspaceId: "__application__",
        key: "activeWorkspace",
        value: id,
      });
    }),
  createPage: (workspaceId: string, patch: Partial<Page> = {}) =>
    write(async () => {
      const p: Page = {
        ...base(workspaceId, "Untitled page"),
        content: emptyDoc(),
        text: "",
        favorite: false,
        ...patch,
        workspaceId,
      };
      await checkParent(p.id, workspaceId, p.parentId);
      await db.pages.add(p);
      return p;
    }),
  createTask: (workspaceId: string, patch: Partial<Task> = {}) =>
    write(async () => {
      const t: Task = {
        ...base(workspaceId, "Untitled task"),
        description: emptyDoc(),
        text: "",
        status: "Backlog",
        priority: "None",
        labels: [],
        pageIds: [],
        subtasks: [],
        order: Date.now(),
        ...patch,
        workspaceId,
      };
      await db.tasks.add(t);
      return t;
    }),
  createProject: (workspaceId: string, patch: Partial<Project> = {}) =>
    write(async () => {
      const p: Project = {
        ...base(workspaceId, "Untitled project"),
        description: "",
        ...patch,
        workspaceId,
      };
      const page: Page = {
        ...base(workspaceId, "Project overview"),
        projectId: p.id,
        content: emptyDoc(),
        text: "",
        favorite: false,
      };
      p.overviewPageId = page.id;
      await db.projects.add(p);
      await db.pages.add(page);
      return p;
    }),
  updatePage: (id: string, patch: Partial<Page>) =>
    queued(() =>
      write(async () => {
        const p = await db.pages.get(id);
        if (!p) throw new Error("Page not found.");
        if ("parentId" in patch)
          await checkParent(id, p.workspaceId, patch.parentId);
        if ("content" in patch || "title" in patch) await revision(p);
        await db.pages.update(id, {
          ...patch,
          id: p.id,
          workspaceId: p.workspaceId,
          createdAt: p.createdAt,
          updatedAt: Date.now(),
        });
      }),
    ),
  savePage: (id: string, content: Doc, text: string) =>
    rawActions.updatePage(id, { content, text }),
  updateTask: (id: string, patch: Partial<Task>) =>
    write(async () => {
      const t = await db.tasks.get(id);
      if (!t) throw new Error("Task not found.");
      await db.tasks.update(id, {
        ...patch,
        id: t.id,
        workspaceId: t.workspaceId,
        createdAt: t.createdAt,
        updatedAt: Date.now(),
      });
    }),
  updateProject: (id: string, patch: Partial<Project>) =>
    write(async () => {
      const p = await db.projects.get(id);
      if (!p) throw new Error("Project not found.");
      await db.projects.update(id, {
        ...patch,
        id: p.id,
        workspaceId: p.workspaceId,
        createdAt: p.createdAt,
        updatedAt: Date.now(),
      });
    }),
  updateWorkspace: (id: string, title: string) =>
    write(async () => {
      await db.workspaces.update(id, { title, updatedAt: Date.now() });
    }),
  movePage: (id: string, parentId?: string) =>
    rawActions.updatePage(id, { parentId }),
  duplicatePage: (id: string) =>
    write(async () => {
      const p = await db.pages.get(id);
      if (!p) throw new Error("Page not found.");
      const copy = {
        ...p,
        ...base(p.workspaceId, p.title + " (copy)"),
        deletedAt: undefined,
      };
      const files = await db.attachments.where("pageId").equals(id).toArray();
      const ids = new Map(files.map((a) => [a.id, uid()]));
      copy.content = remapDoc(copy.content, ids);
      await db.pages.add(copy);
      await db.attachments.bulkAdd(
        files.map((a) => ({ ...a, id: ids.get(a.id)!, pageId: copy.id })),
      );
      return copy;
    }),
  trash: (kind: Kind, id: string) =>
    write(async () => {
      if (kind === "page") {
        const p = await db.pages.get(id);
        if (p) await revision(p, true);
      }
      await table(kind).update(id, {
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }),
  restore: (kind: Kind, id: string) =>
    write(async () => {
      await table(kind).update(id, {
        deletedAt: undefined,
        updatedAt: Date.now(),
      });
    }),
  emptyTrash: (workspaceId: string) =>
    write(async () => {
      for (const t of [db.pages, db.tasks, db.projects]) {
        const deleted = (
          await t.where("workspaceId").equals(workspaceId).toArray()
        ).filter((r) => r.deletedAt);
        for (const r of deleted) {
          if (t === db.pages) {
            await db.attachments.where("pageId").equals(r.id).delete();
            await db.revisions.where("pageId").equals(r.id).delete();
            await db.pages
              .where("parentId")
              .equals(r.id)
              .modify({ parentId: undefined });
            await db.projects
              .where("workspaceId")
              .equals(workspaceId)
              .modify((project) => {
                if (project.overviewPageId === r.id)
                  project.overviewPageId = undefined;
              });
            await db.tasks
              .where("workspaceId")
              .equals(workspaceId)
              .modify((task) => {
                task.pageIds = task.pageIds.filter((id) => id !== r.id);
              });
          }
          if (t === db.projects) {
            await db.pages
              .where("projectId")
              .equals(r.id)
              .modify({ projectId: undefined });
            await db.tasks
              .where("projectId")
              .equals(r.id)
              .modify({ projectId: undefined });
          }
          await t.delete(r.id);
        }
      }
    }),
  restoreRevision: (id: string) =>
    queued(() =>
      write(async () => {
        const r = await db.revisions.get(id);
        if (!r) throw new Error("Revision not found.");
        const p = await db.pages.get(r.pageId);
        if (!p) throw new Error("Page not found.");
        await revision(p, true);
        await db.pages.update(p.id, {
          content: r.content,
          text: r.text,
          title: r.title,
          updatedAt: Date.now(),
        });
      }),
    ),
  setPreference: (workspaceId: string, key: string, value: unknown) =>
    write(async () => {
      await db.preferences.put({
        id: workspaceId + ":" + key,
        workspaceId,
        key,
        value,
      });
    }),
  addAttachment: (workspaceId: string, pageId: string, file: File) =>
    write(async () => {
      const p = await db.pages.get(pageId);
      if (!p || p.workspaceId !== workspaceId)
        throw new Error("Page not found.");
      const a: Attachment = {
        id: uid(),
        workspaceId,
        pageId,
        name: file.name,
        mime: file.type,
        size: file.size,
        blob: file,
        createdAt: Date.now(),
      };
      await db.attachments.add(a);
      return a;
    }),
  removeAttachment: (id: string) =>
    write(async () => {
      await db.attachments.delete(id);
    }),
};

export interface FailedMutation {
  id: string;
  method: keyof typeof rawActions;
  args: unknown[];
}
interface RetainedMutation extends FailedMutation {
  sequence: number;
  originalArgs: unknown[];
}
const failedMutations: RetainedMutation[] = [];
let mutationSequence = 0;
let retryInFlight: Promise<void> | undefined;
export function getFailedMutations(): FailedMutation[] {
  return failedMutations.map(({ id, method, args }) => ({
    id,
    method,
    args: structuredClone(args),
  }));
}
async function recoveryValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return {
      type: "file",
      name: "name" in value ? value.name : "attachment",
      mime: value.type,
      base64: btoa(binary),
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(recoveryValue));
  if (value && typeof value === "object")
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, item]) => [
          key,
          await recoveryValue(item),
        ]),
      ),
    );
  return value;
}
function retryFirst() {
  if (failedMutations.length)
    throw new Error(
      "Unsaved changes need attention. Retry pending saves before making another change.",
    );
}
function documentMutation(method: keyof typeof rawActions, args: unknown[]) {
  return (
    method === "savePage" ||
    (method === "updatePage" &&
      !!args[1] &&
      typeof args[1] === "object" &&
      "content" in args[1]) ||
    (method === "updateTask" &&
      !!args[1] &&
      typeof args[1] === "object" &&
      "description" in args[1])
  );
}
function validationFailure(error: unknown) {
  return (
    error instanceof Error &&
    /^(Page not found\.|Task not found\.|Project not found\.|Workspace not found\.|A page cannot be nested|Choose an existing page)/.test(
      error.message,
    )
  );
}
const wrappers = new Map<PropertyKey, unknown>();
export const actions: typeof rawActions = new Proxy(rawActions, {
  get(target, key: keyof typeof rawActions) {
    if (!wrappers.has(key))
      wrappers.set(key, async (...args: unknown[]) => {
        retryFirst();
        const sequence = ++mutationSequence;
        const originalArgs = args.map((arg) =>
          arg instanceof Blob ? arg : structuredClone(arg),
        );
        try {
          return await Reflect.apply(target[key], target, originalArgs);
        } catch (error) {
          if (!documentMutation(key, args) && !validationFailure(error)) {
            const recoveryArgs = await Promise.all(
              originalArgs.map(recoveryValue),
            );
            failedMutations.push({
              id: uid(),
              method: key,
              args: recoveryArgs,
              originalArgs,
              sequence,
            });
            failedMutations.sort((a, b) => a.sequence - b.sequence);
          }
          throw error;
        }
      });
    return wrappers.get(key);
  },
});
export async function retryFailedMutations(): Promise<void> {
  if (retryInFlight) return retryInFlight;
  retryInFlight = (async () => {
    while (failedMutations.length) {
      const intent = failedMutations[0];
      await Reflect.apply(
        rawActions[intent.method],
        rawActions,
        intent.originalArgs,
      );
      failedMutations.shift();
    }
  })();
  try {
    await retryInFlight;
  } finally {
    retryInFlight = undefined;
  }
}

export async function exportBackup(workspaceId: string): Promise<Blob> {
  await pageQueue.catch(() => undefined);
  const s = await getSnapshot(workspaceId);
  const zip = new JSZip();
  const metadata = {
    ...s,
    attachments: s.attachments.map(({ blob, ...a }) => a),
  };
  zip.file(
    "workspace.json",
    JSON.stringify({ format: "desk95", version: 1, data: metadata }),
  );
  for (const a of s.attachments)
    zip.file("attachments/" + a.id, await a.blob.arrayBuffer());
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
const nodeTypes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
]);
const markTypes = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);
function validDoc(value: unknown, depth = 0): boolean {
  if (depth > 40 || !value || typeof value !== "object" || Array.isArray(value))
    return false;
  const d = value as Doc;
  return (
    nodeTypes.has(d.type) &&
    (depth !== 0 || d.type === "doc") &&
    (d.text === undefined || typeof d.text === "string") &&
    (d.type !== "text" || (typeof d.text === "string" && d.text.length > 0)) &&
    (d.attrs === undefined ||
      (!!d.attrs && typeof d.attrs === "object" && !Array.isArray(d.attrs))) &&
    (d.marks === undefined ||
      (Array.isArray(d.marks) &&
        d.marks.every(
          (m) =>
            !!m &&
            markTypes.has(m.type) &&
            (m.attrs === undefined ||
              (!!m.attrs &&
                typeof m.attrs === "object" &&
                !Array.isArray(m.attrs))),
        ))) &&
    (d.content === undefined ||
      (Array.isArray(d.content) &&
        d.content.every((x) => validDoc(x, depth + 1))))
  );
}
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
function validDate(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validPreference(p: Preference) {
  const v = p.value as any;
  if (p.key === "recent")
    return (
      Array.isArray(v) &&
      v.every(
        (r) =>
          r &&
          ["page", "project", "task"].includes(r.kind) &&
          typeof r.id === "string",
      )
    );
  if (p.key === "lastLocation")
    return (
      typeof v === "string" &&
      /^\/(?:home|inbox|projects|pages|favorites|recent|trash|page|project|task)(?:\/[^/?#]+)?$/.test(
        v,
      )
    );
  if (p.key === "sidebarWidth") return finite(v) && v >= 180 && v <= 380;
  if (p.key === "savedView")
    return (
      !!v &&
      ["all", "Backlog", "To do", "In progress", "Done"].includes(v.filter) &&
      ["all", "None", "Low", "Medium", "High", "Urgent"].includes(
        v.priorityFilter,
      ) &&
      typeof v.labelFilter === "string" &&
      typeof v.dueFilter === "boolean" &&
      ["manual", "title", "priority", "due"].includes(v.sort) &&
      ["board", "list"].includes(v.view)
    );
  return true;
}
function validateBackup(
  value: any,
): asserts value is { format: string; version: number; data: Snapshot } {
  if (value?.format !== "desk95" || value.version !== 1 || !value.data)
    throw new Error("Unsupported Desk95 backup.");
  const s = value.data;
  if (
    !s.workspace ||
    typeof s.workspace.id !== "string" ||
    typeof s.workspace.title !== "string" ||
    !finite(s.workspace.createdAt) ||
    !finite(s.workspace.updatedAt)
  )
    throw new Error("Invalid workspace.");
  const all = [
    "projects",
    "pages",
    "tasks",
    "attachments",
    "revisions",
    "preferences",
  ];
  const seen = new Set<string>();
  for (const key of all) {
    if (!Array.isArray(s[key]) || s[key].length > 100000)
      throw new Error("Invalid backup records.");
    for (const r of s[key]) {
      if (
        !r ||
        typeof r.id !== "string" ||
        r.workspaceId !== s.workspace.id ||
        seen.has(r.id)
      )
        throw new Error("Invalid or duplicate record.");
      seen.add(r.id);
    }
  }
  for (const r of [...s.projects, ...s.pages, ...s.tasks])
    if (
      typeof r.title !== "string" ||
      !finite(r.createdAt) ||
      !finite(r.updatedAt) ||
      (r.deletedAt !== undefined && !finite(r.deletedAt))
    )
      throw new Error("Invalid record fields.");
  const pages = new Map<string, Page>(s.pages.map((p: Page) => [p.id, p]));
  const projects = new Set(s.projects.map((p: Project) => p.id));
  for (const p of s.pages) {
    if (
      !validDoc(p.content) ||
      typeof p.text !== "string" ||
      typeof p.favorite !== "boolean"
    )
      throw new Error("Invalid page.");
    const visited = new Set([p.id]);
    let parent = p.parentId;
    while (parent) {
      if (visited.has(parent) || !pages.has(parent))
        throw new Error("Invalid page hierarchy.");
      visited.add(parent);
      parent = pages.get(parent)!.parentId;
    }
    if (p.projectId && !projects.has(p.projectId))
      throw new Error("Missing project.");
  }
  for (const t of s.tasks)
    if (
      !validDoc(t.description) ||
      typeof t.text !== "string" ||
      !["Backlog", "To do", "In progress", "Done"].includes(t.status) ||
      !["None", "Low", "Medium", "High", "Urgent"].includes(t.priority) ||
      !Array.isArray(t.labels) ||
      !t.labels.every((x: unknown) => typeof x === "string") ||
      !Array.isArray(t.pageIds) ||
      !t.pageIds.every((id: string) => pages.has(id)) ||
      !Array.isArray(t.subtasks) ||
      !t.subtasks.every(
        (x: any) =>
          x &&
          typeof x.id === "string" &&
          typeof x.title === "string" &&
          typeof x.done === "boolean",
      ) ||
      !finite(t.order) ||
      (t.dueDate !== undefined && !validDate(t.dueDate)) ||
      (t.projectId && !projects.has(t.projectId))
    )
      throw new Error("Invalid task.");
  for (const a of s.attachments)
    if (
      !pages.has(a.pageId) ||
      typeof a.name !== "string" ||
      typeof a.mime !== "string" ||
      !Number.isSafeInteger(a.size) ||
      a.size < 0
    )
      throw new Error("Invalid attachment.");
  for (const r of s.revisions)
    if (
      !pages.has(r.pageId) ||
      !validDoc(r.content) ||
      typeof r.text !== "string" ||
      typeof r.title !== "string" ||
      !finite(r.createdAt)
    )
      throw new Error("Invalid revision.");
  for (const p of s.projects)
    if (
      typeof p.description !== "string" ||
      (p.overviewPageId && !pages.has(p.overviewPageId))
    )
      throw new Error("Invalid project.");
  for (const p of s.preferences)
    if (typeof p.key !== "string" || !validPreference(p))
      throw new Error("Invalid preference.");
}
export async function importBackup(
  blob: Blob,
  mode: "separate" | "replace",
  workspaceId?: string,
): Promise<string> {
  retryFirst();
  if (blob.size > 200 * 1024 * 1024)
    throw new Error("Backup exceeds the 200 MB import limit.");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const manifest = zip.file("workspace.json");
  if (!manifest) throw new Error("Missing workspace manifest.");
  const raw = await manifest.async("string");
  if (raw.length > 30000000) throw new Error("Backup manifest is too large.");
  const backup = JSON.parse(raw);
  validateBackup(backup);
  const s = backup.data;
  for (const p of s.pages) p.content = sanitizeContent(p.content) as Doc;
  for (const t of s.tasks)
    t.description = sanitizeContent(t.description) as Doc;
  for (const r of s.revisions) r.content = sanitizeContent(r.content) as Doc;
  let size = 0;
  for (const a of s.attachments) {
    size += a.size;
    if (size > 200 * 1024 * 1024)
      throw new Error("Attachments exceed the 200 MB import limit.");
    const f = zip.file("attachments/" + a.id);
    if (!f) throw new Error("Missing attachment: " + a.name);
    const bytes = await f.async("uint8array");
    if (bytes.length !== a.size) throw new Error("Attachment size mismatch.");
    a.blob = new Blob([bytes as BlobPart], { type: a.mime });
  }
  return write(async () => {
    if (
      mode === "replace" &&
      (!workspaceId || !(await db.workspaces.get(workspaceId)))
    )
      throw new Error("Choose an existing workspace to replace.");
    const target = mode === "replace" ? workspaceId! : uid();
    const ids = new Map<string, string>();
    ids.set(s.workspace.id, target);
    for (const list of [
      s.projects,
      s.pages,
      s.tasks,
      s.attachments,
      s.revisions,
    ])
      for (const r of list) ids.set(r.id, uid());
    const mapped = (id?: string) => (id ? ids.get(id) : undefined);
    if (mode === "replace") {
      for (const t of [
        db.projects,
        db.pages,
        db.tasks,
        db.attachments,
        db.revisions,
        db.preferences,
      ])
        await t.where("workspaceId").equals(target).delete();
    }
    await db.workspaces.put({
      ...s.workspace,
      id: target,
      title:
        mode === "separate"
          ? s.workspace.title + " (imported)"
          : s.workspace.title,
      updatedAt: Date.now(),
    });
    await db.projects.bulkAdd(
      s.projects.map((p) => ({
        ...p,
        id: ids.get(p.id)!,
        workspaceId: target,
        overviewPageId: mapped(p.overviewPageId),
      })),
    );
    await db.pages.bulkAdd(
      s.pages.map((p) => ({
        ...p,
        id: ids.get(p.id)!,
        workspaceId: target,
        parentId: mapped(p.parentId),
        projectId: mapped(p.projectId),
        content: remapDoc(p.content, ids),
      })),
    );
    await db.tasks.bulkAdd(
      s.tasks.map((t) => ({
        ...t,
        id: ids.get(t.id)!,
        workspaceId: target,
        projectId: mapped(t.projectId),
        pageIds: t.pageIds.map((id) => ids.get(id)!),
        subtasks: t.subtasks.map((st) => ({ ...st, id: uid() })),
        description: remapDoc(t.description, ids),
      })),
    );
    await db.attachments.bulkAdd(
      s.attachments.map((a) => ({
        ...a,
        id: ids.get(a.id)!,
        workspaceId: target,
        pageId: ids.get(a.pageId)!,
      })),
    );
    await db.revisions.bulkAdd(
      s.revisions.map((r) => ({
        ...r,
        id: ids.get(r.id)!,
        workspaceId: target,
        pageId: ids.get(r.pageId)!,
        content: remapDoc(r.content, ids),
      })),
    );
    await db.preferences.bulkAdd(
      s.preferences
        .filter((p) => !["lastLocation", "recent"].includes(p.key))
        .map((p) => ({ ...p, id: target + ":" + p.key, workspaceId: target })),
    );
    await db.preferences.put({
      id: "application:activeWorkspace",
      workspaceId: "__application__",
      key: "activeWorkspace",
      value: target,
    });
    return target;
  });
}
