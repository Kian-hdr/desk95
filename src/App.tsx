import { useCallback, useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import type { JSONContent } from "@tiptap/react";
import {
  actions,
  claimEditor,
  db,
  exportBackup,
  getSnapshot,
  getFailedMutations,
  retryFailedMutations,
  heartbeatEditor,
  importBackup,
  initialize,
  isEditor,
  textDoc,
} from "./data";
import type {
  Doc,
  Kind,
  Page,
  Priority,
  Project,
  Snapshot,
  Status,
  Task,
} from "./types";
import Editor from "./Editor";
import { toMarkdown } from "./editor-utils";
import {
  blobToBase64,
  downloadFile,
  importNativeBackup,
  inspectNativeState,
  isNative,
  nativeMessage,
  SaveCancelledError,
  type NativeAPI,
} from "./native";
import { Icon, type IconName } from "./icons";
const statuses: Status[] = ["Backlog", "To do", "In progress", "Done"];
const priorities: Priority[] = ["None", "Low", "Medium", "High", "Urgent"];
type Route = { type: string; id?: string; taskId?: string };
const parseRoute = (): Route => {
  const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
  const [type, id] = path.split("/");
  return {
    type: type || "home",
    id,
    taskId: new URLSearchParams(query).get("task") || undefined,
  };
};
function date(n: number) {
  return new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    ref.current?.showModal();
    (
      ref.current?.querySelector(
        "input, select, textarea",
      ) as HTMLElement | null
    )?.focus();
    return () => trigger?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="titlebar">
        <span>{title}</span>
        <button aria-label="Close dialog" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function ErrorBoundaryFallback() {
  return <div className="startup">Opening your workspace…</div>;
}
export default function App() {
  const [wid, setWid] = useState(""),
    [snapshot, setSnapshot] = useState<Snapshot>(),
    [route, setRoute] = useState<Route>(parseRoute),
    [hasLease, setCanEdit] = useState(false),
    [message, setMessage] = useState("Opening workspace…"),
    [error, setError] = useState("");
  const canEdit = hasLease && getFailedMutations().length === 0;
  const [appearance, setAppearance] = useState(
    () => localStorage.getItem("desk95-appearance") || "system",
  );
  const [modal, setModal] = useState<
    | "settings"
    | "search"
    | "new-page"
    | "new-task"
    | "new-project"
    | "revisions"
    | "import"
    | "help"
    | null
  >(null);
  const [menu, setMenu] = useState(""),
    [drawer, setDrawer] = useState(false),
    [view, setView] = useState<"board" | "list">("board"),
    [projectTab, setProjectTab] = useState<"tasks" | "overview" | "pages">(
      "tasks",
    );
  const [taskId, setTaskId] = useState<string | undefined>(
      () =>
        parseRoute().taskId ||
        (parseRoute().type === "task" ? parseRoute().id : undefined),
    ),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [priorityFilter, setPriorityFilter] = useState("all"),
    [labelFilter, setLabelFilter] = useState(""),
    [dueFilter, setDueFilter] = useState(false),
    [sort, setSort] = useState("manual");
  const [createTitle, setCreateTitle] = useState(""),
    [newStatus, setNewStatus] = useState<Status>("Backlog"),
    [sidebarWidth, setSidebarWidth] = useState(236),
    [workspaces, setWorkspaces] = useState<{ id: string; title: string }[]>([]),
    [backupFile, setBackupFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [updateReady, setUpdateReady] = useState<ServiceWorker>();
  const pending = useRef(
    new Map<
      string,
      { kind: "page" | "task"; content: Doc; text: string; version: number }
    >(),
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const saving = useRef(false),
    inFlight = useRef<Promise<void> | null>(null),
    version = useRef(0);
  const restoredPreferences = useRef("");
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const attachmentUrls = useRef(new Map<string, string>());
  const handleError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setMessage("Save failed · work retained in this tab");
  }, []);
  const flush = useCallback(async () => {
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      saving.current = true;
      try {
        if (getFailedMutations().length)
          throw new Error(
            "Property changes are waiting to save. Choose Retry saves or Export recovery before continuing.",
          );
        while (pending.current.size) {
          const [id, p] = pending.current.entries().next().value!;
          if (p.kind === "page") await actions.savePage(id, p.content, p.text);
          else
            await actions.updateTask(id, {
              description: p.content,
              text: p.text,
            });
          if (pending.current.get(id)?.version === p.version)
            pending.current.delete(id);
        }
        setMessage("Saved locally");
        setError("");
      } catch (e) {
        handleError(e);
      } finally {
        saving.current = false;
      }
    })();
    try {
      await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }, [handleError]);
  const retryAll = useCallback(async () => {
    try {
      await retryFailedMutations();
      await flush();
    } catch (e) {
      handleError(e);
    }
  }, [flush, handleError]);
  const perform = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        setMessage("Saving…");
        await fn();
        if (!pending.current.size) setMessage("Saved locally");
        return true;
      } catch (e) {
        handleError(e);
        return false;
      }
    },
    [handleError],
  );
  const queue = (
    kind: "page" | "task",
    id: string,
    content: JSONContent,
    text: string,
  ) => {
    pending.current.set(id, {
      kind,
      content: content as Doc,
      text,
      version: ++version.current,
    });
    setMessage("Saving…");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 450);
  };
  const go = useCallback(
    (type: string, id?: string) => {
      void flush();
      const current = parseRoute();
      location.hash =
        type === "task"
          ? "/" +
            (current.type === "task" ? "inbox" : current.type) +
            (current.type !== "task" && current.id ? "/" + current.id : "") +
            "?task=" +
            id
          : "/" + type + (id ? "/" + id : "");
      setTaskId(type === "task" ? id : undefined);
      setDrawer(false);
      setMenu("");
    },
    [flush],
  );
  useEffect(() => {
    let cancelled = false;
    initialize()
      .then(async (id) => {
        if (!cancelled) {
          if (isNative()) await claimEditor(true);
          if (cancelled) return;
          setWid(id);
          setCanEdit(isEditor());
          setMessage("Saved locally");
        }
      })
      .catch(handleError);
    return () => {
      cancelled = true;
    };
  }, [handleError]);
  useEffect(() => {
    if (!wid) return;
    const sub = liveQuery(() => getSnapshot(wid)).subscribe({
      next: setSnapshot,
      error: handleError,
    });
    const ws = liveQuery(() => db.workspaces.toArray()).subscribe(
      setWorkspaces,
    );
    return () => {
      sub.unsubscribe();
      ws.unsubscribe();
    };
  }, [wid, handleError]);
  useEffect(() => {
    const onHash = () => {
      const next = parseRoute();
      setRoute(next);
      setTaskId(next.taskId || (next.type === "task" ? next.id : undefined));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        appearance === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appearance;
    };
    apply();
    localStorage.setItem("desk95-appearance", appearance);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
  useEffect(() => {
    const timer = setInterval(() => {
      heartbeatEditor().then(setCanEdit).catch(handleError);
    }, 3000);
    const before = (event: BeforeUnloadEvent) => {
      if (pending.current.size || getFailedMutations().length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      clearInterval(timer);
      window.removeEventListener("beforeunload", before);
    };
  }, [handleError]);
  useEffect(() => {
    if (!snapshot || route.type !== "home") return;
    const last = snapshot.preferences.find((p) => p.key === "lastLocation")
      ?.value as string | undefined;
    if (last && last !== "/home") location.hash = last;
    else if (snapshot.projects.some((p) => !p.deletedAt))
      go("project", snapshot.projects.find((p) => !p.deletedAt)!.id);
    else go("inbox");
  }, [snapshot, route.type, go]);
  useEffect(() => {
    if (!wid || !canEdit || route.type === "home") return;
    void actions
      .setPreference(
        wid,
        "lastLocation",
        "/" + route.type + (route.id ? "/" + route.id : ""),
      )
      .catch(handleError);
    if (route.id && ["page", "project", "task"].includes(route.type)) {
      const rec = (snapshotRef.current?.preferences.find(
        (p) => p.key === "recent",
      )?.value || []) as { kind: string; id: string }[];
      void actions
        .setPreference(
          wid,
          "recent",
          [
            { kind: route.type, id: route.id },
            ...rec.filter((r) => r.id !== route.id),
          ].slice(0, 20),
        )
        .catch(handleError);
    }
  }, [wid, canEdit, route.type, route.id, handleError]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setModal("search");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void retryAll();
      }
      if (e.key === "Escape") {
        setMenu("");
        setDrawer(false);
        if (!modal) setTaskId(undefined);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [flush, modal, retryAll]);
  useEffect(() => {
    if (isNative() || !("serviceWorker" in navigator) || !import.meta.env.PROD)
      return;
    void navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        if (reg.waiting) setUpdateReady(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setUpdateReady(worker);
          });
        });
      })
      .catch(() =>
        setMessage("Offline cache unavailable · local saves still work"),
      );
  }, []);
  useEffect(() => {
    if (snapshot && restoredPreferences.current !== wid) {
      restoredPreferences.current = wid;
      const w = snapshot.preferences.find(
        (p) => p.key === "sidebarWidth",
      )?.value;
      if (typeof w === "number")
        setSidebarWidth(Math.max(180, Math.min(380, w)));
    }
  }, [snapshot, wid]);
  const livePages = snapshot?.pages.filter((p) => !p.deletedAt) || [],
    liveProjects = snapshot?.projects.filter((p) => !p.deletedAt) || [],
    liveTasks = snapshot?.tasks.filter((t) => !t.deletedAt) || [];
  const project = liveProjects.find((p) => p.id === route.id),
    page = livePages.find((p) => p.id === route.id),
    task = liveTasks.find((t) => t.id === taskId);
  const pref = (key: string) =>
    snapshot?.preferences.find((p) => p.key === key)?.value;
  const newItem = (
    kind: "page" | "task" | "project",
    status: Status = "Backlog",
  ) => {
    if (!canEdit) {
      setError("This tab is read-only. Take over editing to create items.");
      return;
    }
    setCreateTitle("");
    setNewStatus(status);
    setModal(("new-" + kind) as typeof modal);
    setMenu("");
  };
  const create = async () => {
    if (!createTitle.trim()) return;
    let result: Page | Task | Project | undefined;
    const kind = modal?.replace("new-", "");
    const okay = await perform(async () => {
      if (kind === "page")
        result = await actions.createPage(wid, {
          title: createTitle.trim(),
          projectId: project?.id,
        });
      if (kind === "task")
        result = await actions.createTask(wid, {
          title: createTitle.trim(),
          projectId: project?.id,
          status: newStatus,
        });
      if (kind === "project")
        result = await actions.createProject(wid, {
          title: createTitle.trim(),
        });
    });
    if (okay && result) {
      setModal(null);
      if (kind === "task") go("task", result.id);
      else go(kind!, result.id);
    }
  };
  const resolveAttachment = useCallback(async (id: string) => {
    if (attachmentUrls.current.has(id)) return attachmentUrls.current.get(id)!;
    const a = await db.attachments.get(id);
    if (!a) return null;
    const u = URL.createObjectURL(a.blob);
    attachmentUrls.current.set(id, u);
    return u;
  }, []);
  const attach = async (file: File) => {
    if (!page) throw new Error("Open a page to attach a file.");
    const a = await actions.addAttachment(wid, page.id, file);
    return {
      id: a.id,
      url: "/__attachment/" + a.id,
      name: a.name,
      mime: a.mime,
    };
  };
  const backup = async () => {
    setBusy(true);
    await flush();
    try {
      if (pending.current.size || getFailedMutations().length) {
        await downloadFile(
          new Blob(
            [
              JSON.stringify({
                documents: [...pending.current.entries()],
                operations: getFailedMutations(),
              }),
            ],
            { type: "application/json" },
          ),
          "Desk95_Unsaved_Recovery.json",
        );
        setMessage("Recovery exported");
        return;
      }
      await downloadFile(
        await exportBackup(wid),
        "Desk95_Backup_" + new Date().toISOString().slice(0, 10) + ".zip",
      );
      setMessage("Backup exported");
    } catch (e) {
      if (e instanceof SaveCancelledError) setMessage("Export canceled");
      else handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const doImport = async (mode: "separate" | "replace") => {
    if (!backupFile) return;
    if (
      mode === "replace" &&
      !confirm(
        "Replace this workspace? Export a backup first if you want to keep its current contents.",
      )
    )
      return;
    setBusy(true);
    await flush();
    try {
      if (pending.current.size || getFailedMutations().length)
        throw new Error("Save or export pending edits before importing.");
      const id = await importBackup(backupFile, mode, wid);
      setWid(id);
      setSnapshot(undefined);
      setModal(null);
      location.hash = "/inbox";
      setMessage("Backup restored locally");
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const trash = async (kind: Kind, id: string) => {
    await flush();
    if (pending.current.size || getFailedMutations().length) {
      handleError(
        new Error("Save pending edits before moving items to Trash."),
      );
      return;
    }
    if (await perform(() => actions.trash(kind, id))) {
      if (kind === "task") setTaskId(undefined);
      else go(kind === "page" ? "pages" : "projects");
    }
  };
  const linkedTask = async (text: string) => {
    if (!page || !text.trim()) return;
    await perform(async () => {
      const t = await actions.createTask(wid, {
        title: text.trim().slice(0, 140),
        description: textDoc(text),
        text,
        projectId: page.projectId,
        pageIds: [page.id],
      });
      go("task", t.id);
    });
  };
  const resize = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = e.clientX,
      w = sidebarWidth;
    let last = w;
    const move = (ev: PointerEvent) => {
      last = Math.max(180, Math.min(380, w + ev.clientX - start));
      setSidebarWidth(last);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (canEdit)
        void actions
          .setPreference(wid, "sidebarWidth", last)
          .catch(handleError);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  const currentWid = useRef(wid);
  currentWid.current = wid;
  const nativeAPIRef = useRef<NativeAPI | undefined>(undefined);
  const nativeCommandsRef = useRef<(name: string) => void>(() => {});
  nativeAPIRef.current = {
    prepareToClose: async () => {
      try {
        await claimEditor(true);
        await retryFailedMutations();
        await flush();
        if (pending.current.size || getFailedMutations().length)
          return {
            ok: false,
            reason:
              "Some changes could not be saved. Keep Desk95 open and retry or export recovery.",
          };
        return { ok: true };
      } catch (e) {
        handleError(e);
        return {
          ok: false,
          reason: e instanceof Error ? e.message : String(e),
        };
      }
    },
    inspect: () => inspectNativeState(currentWid.current, pending.current.size),
    exportBackup: async () => {
      const ready = await nativeAPIRef.current!.prepareToClose();
      if (!ready.ok) throw new Error(ready.reason);
      return {
        base64: await blobToBase64(await exportBackup(currentWid.current)),
        name: "Desk95_Backup_" + new Date().toISOString().slice(0, 10) + ".zip",
      };
    },
    importBackup: async (base64) => {
      try {
        const ready = await nativeAPIRef.current!.prepareToClose();
        if (!ready.ok) throw new Error(ready.reason);
        const imported = await importNativeBackup(base64);
        currentWid.current = imported.workspaceId;
        setWid(imported.workspaceId);
        setSnapshot(undefined);
        setModal(null);
        location.hash = "/inbox";
        setMessage(
          imported.alreadyImported
            ? "Previously imported workspace opened"
            : "Backup restored locally",
        );
        return {
          ...(await inspectNativeState(
            imported.workspaceId,
            pending.current.size,
          )),
          alreadyImported: imported.alreadyImported,
        };
      } catch (error) {
        handleError(error);
        throw error;
      }
    },
  };
  nativeCommandsRef.current = (name) => {
    if (name === "new-page") newItem("page");
    else if (name === "new-task") newItem("task");
    else if (name === "new-project") newItem("project");
    else if (name === "search") {
      setQuery("");
      setModal("search");
    } else if (name === "settings") setModal("settings");
    else if (name === "export") void backup();
    else if (name === "import") setModal("import");
    else if (name === "save") void retryAll();
  };
  useEffect(() => {
    if (!isNative() || !wid) return;
    const api: NativeAPI = {
      prepareToClose: () => nativeAPIRef.current!.prepareToClose(),
      inspect: () => nativeAPIRef.current!.inspect(),
      importBackup: (value) => nativeAPIRef.current!.importBackup(value),
      exportBackup: () => nativeAPIRef.current!.exportBackup(),
    };
    window.desk95Native = api;
    const command = (event: Event) => {
      const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
      if (typeof name === "string") nativeCommandsRef.current(name);
    };
    window.addEventListener("desk95:command", command);
    void api
      .inspect()
      .then((summary) => nativeMessage({ command: "ready", summary }))
      .catch(handleError);
    return () => {
      window.removeEventListener("desk95:command", command);
      if (window.desk95Native === api) delete window.desk95Native;
    };
  }, [wid, handleError]);
  const nav = (type: string, label: string, icon: IconName, count?: number) => (
    <button
      className={"nav-item " + (route.type === type ? "selected" : "")}
      onClick={() => go(type)}
    >
      <Icon name={icon} />
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  const title =
    route.type === "project"
      ? project?.title || "Project not found"
      : route.type === "page"
        ? page?.title || "Page not found"
        : {
            task: "Task details",
            inbox: "Inbox",
            projects: "Projects",
            pages: "All pages",
            favorites: "Favorites",
            recent: "Recently opened",
            trash: "Recycle Bin",
          }[route.type] || "Workspace";
  const filteredTasks = liveTasks
    .filter((t) =>
      route.type === "project"
        ? t.projectId === project?.id
        : route.type === "inbox"
          ? !t.projectId
          : true,
    )
    .filter((t) => filter === "all" || t.status === filter)
    .filter((t) => priorityFilter === "all" || t.priority === priorityFilter)
    .filter(
      (t) =>
        !labelFilter ||
        t.labels.some((l) =>
          l.toLowerCase().includes(labelFilter.toLowerCase()),
        ),
    )
    .filter(
      (t) =>
        !dueFilter ||
        (!!t.dueDate &&
          t.dueDate <=
            new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA")),
    )
    .filter(
      (t) =>
        !query ||
        modal === "search" ||
        (t.title + " " + t.text).toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "priority"
          ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
          : sort === "due"
            ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
            : a.order - b.order,
    );
  const moveTask = (id: string, status: Status, beforeId?: string) =>
    perform(async () => {
      const moving = snapshotRef.current?.tasks.find((t) => t.id === id);
      if (!moving) return;
      const column = (snapshotRef.current?.tasks || [])
        .filter(
          (t) =>
            !t.deletedAt &&
            t.id !== id &&
            t.status === status &&
            t.projectId === moving.projectId,
        )
        .sort((a, b) => a.order - b.order);
      const index = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
      const order =
        index === 0
          ? column[0].order - 1
          : index > 0
            ? (column[index - 1].order + column[index].order) / 2
            : column.length
              ? column[column.length - 1].order + 1
              : 0;
      await actions.updateTask(id, { status, order });
    });
  const taskCard = (t: Task, board = false) => (
    <div
      className={"task-card " + (board ? "" : "task-row")}
      key={t.id}
      draggable={canEdit && sort === "manual"}
      onDragStart={(e) => e.dataTransfer.setData("text/desk95-task", t.id)}
      onDragOver={(e) => {
        if (board) e.preventDefault();
      }}
      onDrop={(e) => {
        if (board) {
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData("text/desk95-task");
          if (id && id !== t.id) void moveTask(id, t.status, t.id);
        }
      }}
    >
      <button className="task-open" onClick={() => go("task", t.id)}>
        <span
          className={"status-dot status-" + t.status.replaceAll(" ", "-")}
          aria-label={t.status}
        />
        <span className="task-card-title">{t.title}</span>
      </button>
      <div className="task-meta">
        <span className={"priority priority-" + t.priority}>
          {t.priority === "None" ? "—" : t.priority}
        </span>
        {t.labels.map((l) => (
          <span className="tag" key={l}>
            {l}
          </span>
        ))}
        {t.dueDate && <span>{t.dueDate}</span>}
        <span className="task-code">D95-{t.id.slice(0, 4).toUpperCase()}</span>
      </div>
      {!board && (
        <select
          aria-label={"Status for " + t.title}
          disabled={!canEdit}
          value={t.status}
          onChange={(e) =>
            void perform(() =>
              actions.updateTask(t.id, { status: e.target.value as Status }),
            )
          }
        >
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  );
  const renderTasks = () => (
    <>
      <div className="view-toolbar">
        <div className="view-toggle">
          <button
            aria-pressed={view === "board"}
            className={view === "board" ? "pressed" : ""}
            onClick={() => setView("board")}
          >
            <Icon name="board" size={16} />
            Board
          </button>
          <button
            aria-pressed={view === "list"}
            className={view === "list" ? "pressed" : ""}
            onClick={() => setView("list")}
          >
            <Icon name="list" size={16} />
            List
          </button>
        </div>
        <select
          aria-label="Filter status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter priority"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="all">All priorities</option>
          {priorities.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Sort tasks"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="manual">Manual order</option>
          <option value="title">Title</option>
          <option value="priority">Priority</option>
          <option value="due">Due date</option>
        </select>
        <button
          disabled={!canEdit}
          onClick={() =>
            void perform(() =>
              actions.setPreference(wid, "savedView", {
                filter,
                priorityFilter,
                labelFilter,
                dueFilter,
                sort,
                view,
              }),
            )
          }
        >
          Save view
        </button>
        {!!pref("savedView") && (
          <button
            onClick={() => {
              const v = pref("savedView") as any;
              setFilter(v.filter);
              setPriorityFilter(v.priorityFilter);
              setLabelFilter(v.labelFilter);
              setDueFilter(v.dueFilter);
              setSort(v.sort);
              setView(v.view);
            }}
          >
            Load view
          </button>
        )}
        <span className="grow" />
        <button disabled={!canEdit} onClick={() => newItem("task")}>
          <Icon name="plus" size={14} />
          New task
        </button>
      </div>
      <div className="filter-bar">
        <input
          aria-label="Filter task labels"
          placeholder="Filter labels…"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={dueFilter}
            onChange={(e) => setDueFilter(e.target.checked)}
          />
          Due in the next 7 days or overdue
        </label>
        <span>{filteredTasks.length} tasks</span>
      </div>
      {view === "board" ? (
        <div className="board">
          {statuses.map((s) => (
            <section
              className="board-column"
              key={s}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/desk95-task");
                if (id && canEdit) void moveTask(id, s);
              }}
            >
              <div className="column-heading">
                <span
                  className={"status-dot status-" + s.replaceAll(" ", "-")}
                />
                <h2>{s}</h2>
                <span className="column-count">
                  {filteredTasks.filter((t) => t.status === s).length}
                </span>
                <button
                  className="plain"
                  aria-label={"Add " + s + " task"}
                  disabled={!canEdit}
                  onClick={() => newItem("task", s)}
                >
                  +
                </button>
              </div>
              <div className="column-cards">
                {filteredTasks
                  .filter((t) => t.status === s)
                  .map((t) => taskCard(t, true))}
              </div>
              <button
                className="add-task"
                disabled={!canEdit}
                onClick={() => newItem("task", s)}
              >
                + Add task
              </button>
            </section>
          ))}
        </div>
      ) : (
        <div className="list-view">
          {filteredTasks.length ? (
            filteredTasks.map((t) => taskCard(t))
          ) : (
            <div className="empty">
              <Icon name="tasks" size={40} />
              <h2>A clear desk.</h2>
              <p>Create a task or adjust your filters to get started.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
  const pageTree = (parent?: string, depth = 0): React.ReactNode =>
    depth > 20
      ? null
      : livePages
          .filter((p) => p.parentId === parent)
          .map((p) => (
            <div key={p.id}>
              <button
                className={
                  "nav-item page-nav " + (route.id === p.id ? "selected" : "")
                }
                style={{ paddingLeft: 12 + depth * 14 }}
                onClick={() => go("page", p.id)}
              >
                <Icon name="page" size={17} />
                <span>{p.title}</span>
              </button>
              {pageTree(p.id, depth + 1)}
            </div>
          ));
  if (!snapshot)
    return (
      <>
        <ErrorBoundaryFallback />
        {error && (
          <div role="alert" className="startup-error">
            {error}
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        )}
      </>
    );
  return (
    <div className="desktop">
      <div className="application">
        <header className="titlebar">
          <div>
            <Icon name="computer" size={19} />
            <strong>Desk95</strong>
            <span className="title-divider">|</span>
            <span>{snapshot.workspace.title}</span>
          </div>
          <div className="window-controls">
            <button
              aria-label="Open appearance settings"
              onClick={() => setModal("settings")}
            >
              <Icon name="settings" size={13} />
            </button>
            <button
              aria-label="Toggle full screen"
              onClick={() => {
                if (isNative()) {
                  void nativeMessage({ command: "toggleFullscreen" }).catch(
                    handleError,
                  );
                  return;
                }
                if (document.fullscreenElement) void document.exitFullscreen();
                else void document.documentElement.requestFullscreen?.();
              }}
            >
              □
            </button>
          </div>
        </header>
        <div className="menubar">
          {["File", "Edit", "View", "Help"].map((m) => (
            <div className="menu-wrap" key={m}>
              <button
                className={menu === m ? "pressed" : ""}
                aria-expanded={menu === m}
                onClick={() => setMenu(menu === m ? "" : m)}
              >
                {m}
              </button>
              {menu === m && (
                <>
                  <div className="menu-dismiss" onClick={() => setMenu("")} />
                  <div className="menu-popup">
                    {(m === "File"
                      ? [
                          ["New page", () => newItem("page")],
                          ["New task", () => newItem("task")],
                          ["New project", () => newItem("project")],
                          [
                            "Export workspace backup…",
                            () => {
                              void backup();
                              setMenu("");
                            },
                          ],
                          [
                            "Import workspace backup…",
                            () => {
                              setModal("import");
                              setMenu("");
                            },
                          ],
                        ]
                      : m === "Edit"
                        ? [
                            [
                              "Find / Command palette",
                              () => {
                                setModal("search");
                                setMenu("");
                              },
                            ],
                            [
                              "Retry pending saves",
                              () => {
                                void retryAll();
                                setMenu("");
                              },
                            ],
                          ]
                        : m === "View"
                          ? [
                              [
                                "Board view",
                                () => {
                                  setView("board");
                                  setMenu("");
                                },
                              ],
                              [
                                "List view",
                                () => {
                                  setView("list");
                                  setMenu("");
                                },
                              ],
                              [
                                "Appearance & settings…",
                                () => {
                                  setModal("settings");
                                  setMenu("");
                                },
                              ],
                            ]
                          : [
                              [
                                "Using Desk95",
                                () => {
                                  setModal("help");
                                  setMenu("");
                                },
                              ],
                            ]
                    ).map(([label, fn]) => (
                      <button key={label as string} onClick={fn as () => void}>
                        {label as string}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
          <span className="grow" />
          <span className="local-label">
            <span className="online-dot" />
            Local workspace
          </span>
        </div>
        <div className="global-toolbar">
          <button
            className="mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setDrawer(!drawer)}
          >
            ☰
          </button>
          <button
            className="search-launch"
            onClick={() => {
              setQuery("");
              setModal("search");
            }}
          >
            <Icon name="search" size={17} />
            <span>Find anything…</span>
            <kbd>⌘ / Ctrl K</kbd>
          </button>
          <span className="grow" />
          <span className="toolbar-caption">
            A place for your next good idea.
          </span>
          <button onClick={() => setModal("settings")}>
            <Icon name="settings" size={16} />
            <span className="settings-label">Settings</span>
          </button>
        </div>
        {!hasLease && (
          <div className="notice" role="status">
            This tab is read-only. Another tab owns editing.{" "}
            <button
              onClick={() =>
                void claimEditor(true).then(setCanEdit).catch(handleError)
              }
            >
              Take over editing
            </button>
          </div>
        )}
        {(error || getFailedMutations().length > 0) && (
          <div className="error-banner" role="alert">
            {error ||
              "Property changes are waiting to save. Retry them or export a recovery copy."}
            <button onClick={() => void retryAll()}>Retry saves</button>
            <button onClick={() => void backup()}>Export recovery</button>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {updateReady && (
          <div className="notice">
            An update is ready.
            <button
              onClick={async () => {
                await flush();
                if (!pending.current.size && !getFailedMutations().length) {
                  updateReady.postMessage({ type: "SKIP_WAITING" });
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                }
              }}
            >
              Save and update
            </button>
          </div>
        )}
        <div
          className="workspace-body"
          style={
            { "--sidebar-width": sidebarWidth + "px" } as React.CSSProperties
          }
        >
          {drawer && (
            <div className="drawer-shade" onClick={() => setDrawer(false)} />
          )}
          <aside className={"sidebar " + (drawer ? "drawer-open" : "")}>
            <div className="workspace-switch">
              <Icon name="computer" size={30} />
              <div>
                <strong>{snapshot.workspace.title}</strong>
                <small>Your personal corner of the internet</small>
              </div>
            </div>
            {workspaces.length > 1 && (
              <select
                aria-label="Switch workspace"
                value={wid}
                onChange={async (e) => {
                  await flush();
                  if (pending.current.size || getFailedMutations().length)
                    return;
                  if (
                    !(await perform(() =>
                      actions.selectWorkspace(e.target.value),
                    ))
                  )
                    return;
                  setWid(e.target.value);
                  go("inbox");
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            )}
            <nav aria-label="Workspace navigation">
              {nav(
                "inbox",
                "Inbox",
                "tasks",
                liveTasks.filter((t) => !t.projectId).length,
              )}
              {nav("projects", "Projects", "folder", liveProjects.length)}
              {nav("pages", "All pages", "page", livePages.length)}
              {nav("favorites", "Favorites", "star")}
              {nav("recent", "Recently opened", "clock")}
              <div className="nav-section">
                <span>PROJECTS</span>
                <button
                  aria-label="New project"
                  disabled={!canEdit}
                  onClick={() => newItem("project")}
                >
                  +
                </button>
              </div>
              {liveProjects.map((p) => (
                <button
                  key={p.id}
                  className={
                    "nav-item " + (route.id === p.id ? "selected" : "")
                  }
                  onClick={() => {
                    setProjectTab("tasks");
                    go("project", p.id);
                  }}
                >
                  <Icon name="folder" />
                  <span>{p.title}</span>
                </button>
              ))}
              <div className="nav-section">
                <span>PAGES</span>
                <button
                  aria-label="New page"
                  disabled={!canEdit}
                  onClick={() => newItem("page")}
                >
                  +
                </button>
              </div>
              {pageTree()}
            </nav>
            <div className="sidebar-bottom">
              {nav("trash", "Recycle Bin", "trash")}
              <div className="local-note">
                <Icon name="save" size={20} />
                <div>
                  Yours. Locally saved.
                  <small>Export a backup to keep it safe.</small>
                </div>
              </div>
            </div>
          </aside>
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
            aria-valuenow={sidebarWidth}
            aria-valuemin={180}
            aria-valuemax={380}
            tabIndex={0}
            onPointerDown={resize}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight")
                setSidebarWidth(Math.min(380, sidebarWidth + 12));
              if (e.key === "ArrowLeft")
                setSidebarWidth(Math.max(180, sidebarWidth - 12));
            }}
          />
          <main>
            <div className="breadcrumb">
              <Icon
                name={route.type === "page" ? "page" : "folder"}
                size={16}
              />
              <span>Workspace</span>
              <span>›</span>
              <span>{title}</span>
            </div>
            <div className="content-scroll">
              <div className="content-heading">
                <div>
                  <h1>{title}</h1>
                  <p>
                    {project
                      ? project.description ||
                        "Bring your ideas and the work together."
                      : route.type === "inbox"
                        ? "Capture now. Find a home for it later."
                        : route.type === "pages"
                          ? "A little space to think things through."
                          : route.type === "trash"
                            ? "Deleted items stay here until you empty the bin."
                            : route.type === "projects"
                              ? "Good work starts with a place to put it."
                              : route.type === "page"
                                ? ""
                                : "The things you want to keep close."}
                  </p>
                </div>
                {project && (
                  <button
                    disabled={!canEdit}
                    aria-label="Move project to Trash"
                    onClick={() => void trash("project", project.id)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
                {["pages", "favorites"].includes(route.type) && (
                  <button disabled={!canEdit} onClick={() => newItem("page")}>
                    <Icon name="plus" size={15} />
                    New page
                  </button>
                )}
                {route.type === "projects" && (
                  <button
                    disabled={!canEdit}
                    onClick={() => newItem("project")}
                  >
                    + New project
                  </button>
                )}
              </div>
              {project && (
                <>
                  <div className="project-summary">
                    <span>
                      <Icon name="tasks" size={17} />
                      {
                        liveTasks.filter(
                          (t) =>
                            t.projectId === project.id && t.status === "Done",
                        ).length
                      }{" "}
                      of{" "}
                      {
                        liveTasks.filter((t) => t.projectId === project.id)
                          .length
                      }{" "}
                      tasks complete
                    </span>
                    <progress
                      aria-label="Project completion"
                      max={Math.max(
                        1,
                        liveTasks.filter((t) => t.projectId === project.id)
                          .length,
                      )}
                      value={
                        liveTasks.filter(
                          (t) =>
                            t.projectId === project.id && t.status === "Done",
                        ).length
                      }
                    />
                    <button
                      disabled={!canEdit}
                      onClick={() => {
                        const title = prompt("Project name", project.title);
                        if (title?.trim())
                          void perform(() =>
                            actions.updateProject(project.id, {
                              title: title.trim(),
                            }),
                          );
                      }}
                    >
                      Rename
                    </button>
                    <button
                      disabled={!canEdit}
                      onClick={() => {
                        const description = prompt(
                          "Project description",
                          project.description,
                        );
                        if (description !== null)
                          void perform(() =>
                            actions.updateProject(project.id, { description }),
                          );
                      }}
                    >
                      Edit description
                    </button>
                  </div>
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Project sections"
                  >
                    {(["tasks", "overview", "pages"] as const).map((t) => (
                      <button
                        role="tab"
                        aria-selected={projectTab === t}
                        className={projectTab === t ? "active" : ""}
                        key={t}
                        onClick={() => setProjectTab(t)}
                      >
                        {t[0].toUpperCase() + t.slice(1)}
                      </button>
                    ))}
                  </div>
                  {projectTab === "tasks" ? (
                    renderTasks()
                  ) : projectTab === "overview" ? (
                    <div className="project-overview">
                      <p>
                        Your project brief lives in a page, so you can edit it
                        and link tasks to it.
                      </p>
                      {project.overviewPageId &&
                      livePages.some((p) => p.id === project.overviewPageId) ? (
                        <button
                          onClick={() => go("page", project.overviewPageId)}
                        >
                          Open project overview
                        </button>
                      ) : (
                        <button
                          disabled={!canEdit}
                          onClick={() =>
                            void perform(async () => {
                              const p = await actions.createPage(wid, {
                                title: "Project overview",
                                projectId: project.id,
                              });
                              await actions.updateProject(project.id, {
                                overviewPageId: p.id,
                              });
                              go("page", p.id);
                            })
                          }
                        >
                          Create project overview
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="item-list">
                      {livePages
                        .filter((p) => p.projectId === project.id)
                        .map((p) => (
                          <button
                            key={p.id}
                            className="item"
                            onClick={() => go("page", p.id)}
                          >
                            <Icon name="page" />
                            <span>{p.title}</span>
                            <small>{date(p.updatedAt)}</small>
                          </button>
                        ))}
                      <button
                        disabled={!canEdit}
                        onClick={() => newItem("page")}
                      >
                        + Add page to project
                      </button>
                    </div>
                  )}
                </>
              )}
              {["inbox", "task"].includes(route.type) && renderTasks()}
              {route.type === "page" && page && (
                <>
                  <div className="page-actions">
                    <button
                      aria-pressed={page.favorite}
                      disabled={!canEdit}
                      onClick={() =>
                        void perform(() =>
                          actions.updatePage(page.id, {
                            favorite: !page.favorite,
                          }),
                        )
                      }
                    >
                      <Icon name="star" size={16} />
                      {page.favorite ? "Favorited" : "Favorite"}
                    </button>
                    <button
                      disabled={!canEdit}
                      onClick={async () => {
                        await flush();
                        if (pending.current.size || getFailedMutations().length)
                          return;
                        const p = await actions.duplicatePage(page.id);
                        go("page", p.id);
                      }}
                    >
                      Duplicate
                    </button>
                    <button onClick={() => setModal("revisions")}>
                      History
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await flush();
                          const doc =
                            pending.current.get(page.id)?.content ||
                            (await db.pages.get(page.id))?.content ||
                            page.content;
                          await downloadFile(
                            new Blob([toMarkdown(doc)], {
                              type: "text/markdown",
                            }),
                            page.title.replace(/[^a-zA-Z0-9_-]/g, "_") + ".md",
                          );
                        } catch (e) {
                          if (e instanceof SaveCancelledError)
                            setMessage("Export canceled");
                          else handleError(e);
                        }
                      }}
                    >
                      Export .md
                    </button>
                    <span className="grow" />
                    <button
                      aria-label="Move page to Trash"
                      disabled={!canEdit}
                      onClick={() => void trash("page", page.id)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="page-properties">
                    <Field label="Page title">
                      <input
                        aria-label="Page title"
                        key={page.id + "title"}
                        defaultValue={page.title}
                        disabled={!canEdit}
                        onBlur={(e) => {
                          if (
                            e.target.value.trim() &&
                            e.target.value !== page.title
                          )
                            void perform(() =>
                              actions.updatePage(page.id, {
                                title: e.target.value.trim(),
                              }),
                            );
                        }}
                      />
                    </Field>
                    <Field label="Parent page">
                      <select
                        disabled={!canEdit}
                        value={page.parentId || ""}
                        onChange={(e) =>
                          void perform(() =>
                            actions.movePage(
                              page.id,
                              e.target.value || undefined,
                            ),
                          )
                        }
                      >
                        <option value="">Top level</option>
                        {livePages
                          .filter((p) => p.id !== page.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Project">
                      <select
                        disabled={!canEdit}
                        value={page.projectId || ""}
                        onChange={(e) =>
                          void perform(() =>
                            actions.updatePage(page.id, {
                              projectId: e.target.value || undefined,
                            }),
                          )
                        }
                      >
                        <option value="">No project</option>
                        {liveProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="document-paper">
                    <Editor
                      key={page.id}
                      content={
                        pending.current.get(page.id)?.content || page.content
                      }
                      editable={canEdit}
                      onChange={(json, text) =>
                        queue("page", page.id, json, text)
                      }
                      onCreateTask={(text) => void linkedTask(text)}
                      pages={livePages}
                      onAttach={attach}
                      resolveAttachment={resolveAttachment}
                      onSaveError={(msg) => handleError(new Error(msg))}
                    />
                  </div>
                  <div className="linked-tasks">
                    <h2>Linked tasks</h2>
                    {liveTasks
                      .filter((t) => t.pageIds.includes(page.id))
                      .map((t) => (
                        <button key={t.id} onClick={() => go("task", t.id)}>
                          <span
                            className={
                              "status-dot status-" +
                              t.status.replaceAll(" ", "-")
                            }
                          />
                          {t.title}
                        </button>
                      ))}
                    {!liveTasks.some((t) => t.pageIds.includes(page.id)) && (
                      <p>
                        Select text in your document, then choose “Create task”
                        in the editor.
                      </p>
                    )}
                  </div>
                </>
              )}
              {route.type === "projects" && (
                <div className="project-list">
                  {liveProjects.map((p) => {
                    const ts = liveTasks.filter((t) => t.projectId === p.id),
                      done = ts.filter((t) => t.status === "Done").length;
                    return (
                      <button
                        className="project-item"
                        key={p.id}
                        onClick={() => {
                          setProjectTab("tasks");
                          go("project", p.id);
                        }}
                      >
                        <Icon name="folder" size={38} />
                        <div>
                          <h2>{p.title}</h2>
                          <p>{p.description || "No description yet."}</p>
                          <small>
                            {done} / {ts.length} tasks complete
                          </small>
                        </div>
                        <Icon name="arrow" />
                      </button>
                    );
                  })}
                  {!liveProjects.length && (
                    <div className="empty">
                      <h2>Your next project starts here.</h2>
                      <p>
                        Create a project to keep its brief, pages, and tasks
                        together.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {["pages", "favorites", "recent"].includes(route.type) && (
                <div className="item-list">
                  {(route.type === "recent"
                    ? ((pref("recent") || []) as { kind: string; id: string }[])
                        .map((r) => ({
                          kind: r.kind,
                          item: (r.kind === "page"
                            ? livePages
                            : r.kind === "task"
                              ? liveTasks
                              : liveProjects
                          ).find((p) => p.id === r.id),
                        }))
                        .filter((x) => x.item)
                    : livePages
                        .filter((p) => route.type !== "favorites" || p.favorite)
                        .sort((a, b) => b.updatedAt - a.updatedAt)
                        .map((item) => ({ kind: "page", item }))
                  ).map(({ kind, item }) => (
                    <button
                      className="item"
                      key={item!.id}
                      onClick={() => go(kind, item!.id)}
                    >
                      <Icon name={kind === "page" ? "page" : "folder"} />
                      <span>{item!.title}</span>
                      <small>{date(item!.updatedAt)}</small>
                      <Icon name="arrow" size={14} />
                    </button>
                  ))}
                </div>
              )}
              {route.type === "trash" && (
                <>
                  <div className="page-actions">
                    <button
                      disabled={!canEdit}
                      onClick={() => {
                        if (
                          confirm(
                            "Permanently delete all items in the Recycle Bin? Export a backup first to keep a recovery copy.",
                          )
                        )
                          void perform(() => actions.emptyTrash(wid));
                      }}
                    >
                      Empty Recycle Bin…
                    </button>
                    <button onClick={() => void backup()}>
                      Export backup first
                    </button>
                  </div>
                  <div className="item-list">
                    {(["page", "task", "project"] as Kind[]).flatMap((kind) =>
                      (kind === "page"
                        ? snapshot.pages
                        : kind === "task"
                          ? snapshot.tasks
                          : snapshot.projects
                      )
                        .filter((i) => i.deletedAt)
                        .map((item) => (
                          <div className="item" key={item.id}>
                            <Icon
                              name={
                                kind === "page"
                                  ? "page"
                                  : kind === "task"
                                    ? "tasks"
                                    : "folder"
                              }
                            />
                            <span>{item.title}</span>
                            <small>{kind}</small>
                            <button
                              disabled={!canEdit}
                              onClick={() =>
                                void perform(() =>
                                  actions.restore(kind, item.id),
                                )
                              }
                            >
                              Restore
                            </button>
                          </div>
                        )),
                    )}
                  </div>
                </>
              )}
              {((route.type === "page" && !page) ||
                (route.type === "project" && !project)) && (
                <div className="empty">
                  <h2>This item isn’t available.</h2>
                  <p>It may be in the Recycle Bin or another workspace.</p>
                  <button onClick={() => go("trash")}>Open Recycle Bin</button>
                </div>
              )}
            </div>
          </main>
          {task && (
            <TaskPanel
              key={task.id}
              task={{
                ...task,
                description:
                  pending.current.get(task.id)?.content || task.description,
              }}
              projects={liveProjects}
              pages={livePages}
              canEdit={canEdit}
              onClose={() => {
                void flush();
                setTaskId(undefined);
                if (route.taskId) go(route.type, route.id);
                else if (route.type === "task") {
                  const t = liveTasks.find((t) => t.id === route.id);
                  go(t?.projectId ? "project" : "inbox", t?.projectId);
                }
              }}
              onUpdate={(patch) =>
                void perform(() => actions.updateTask(task.id, patch))
              }
              onContent={(content, text) =>
                queue("task", task.id, content, text)
              }
              onTrash={() => void trash("task", task.id)}
              resolveAttachment={resolveAttachment}
            />
          )}
        </div>
        <footer className="statusbar">
          <span role="status" aria-live="polite">
            <Icon name="save" size={14} />
            {message}
          </span>
          <span>
            {livePages.length} pages · {liveTasks.length} tasks
          </span>
          <span>
            {canEdit ? "Editing enabled" : "Read-only"} ·{" "}
            {appearance === "system"
              ? "System appearance"
              : appearance + " mode"}
          </span>
        </footer>
      </div>
      <div className="desktop-taskbar">
        <button className="start-button" onClick={() => setModal("search")}>
          <Icon name="computer" size={21} />
          <strong>Desk95</strong>
        </button>
        <div className="taskbar-active">
          <Icon name="folder" size={17} />
          {title}
        </div>
        <span className="grow" />
        <span className="taskbar-clock">
          {new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      {modal && (
        <Modal
          title={
            modal.startsWith("new-")
              ? "New " + modal.replace("new-", "")
              : modal === "settings"
                ? "Desk95 Settings"
                : modal === "search"
                  ? "Find & commands"
                  : modal === "revisions"
                    ? "Page history"
                    : modal === "import"
                      ? "Restore a workspace"
                      : "Welcome to Desk95"
          }
          onClose={() => {
            setModal(null);
            setQuery("");
          }}
        >
          {modal.startsWith("new-") && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Field label="Name">
                <input
                  autoFocus
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </Field>
              {modal === "new-task" && (
                <Field label="Status">
                  <select
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as Status)}
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="dialog-buttons">
                <button type="button" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  disabled={!canEdit || !createTitle.trim()}
                  type="submit"
                >
                  Create
                </button>
              </div>
            </form>
          )}
          {modal === "settings" && (
            <>
              <div className="settings-section">
                <h2>Make yourself at home.</h2>
                <p>Classic outside. Your preferences inside.</p>
                <Field label="Appearance">
                  <select
                    aria-label="Appearance"
                    value={appearance}
                    onChange={(e) => setAppearance(e.target.value)}
                  >
                    <option value="system">System (automatic)</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </Field>
                <Field label="Workspace name">
                  <input
                    defaultValue={snapshot.workspace.title}
                    disabled={!canEdit}
                    onBlur={(e) => {
                      if (e.target.value.trim())
                        void perform(() =>
                          actions.updateWorkspace(wid, e.target.value.trim()),
                        );
                    }}
                  />
                </Field>
              </div>
              <fieldset>
                <legend>Local storage & recovery</legend>
                <p>
                  {isNative()
                    ? "Your work is stored by Desk95 on this Mac, separately from your browser. Keep exported backups somewhere safe."
                    : "Your work is stored in this browser profile on this device. Clearing site data removes it. Keep exported backups somewhere safe."}
                </p>
                {!isNative() && (
                  <button
                    onClick={() =>
                      void navigator.storage
                        ?.persist?.()
                        .then((granted) =>
                          setMessage(
                            granted
                              ? "Persistent storage granted"
                              : "Browser did not grant persistent storage",
                          ),
                        )
                        .catch(handleError)
                    }
                  >
                    Request persistent storage
                  </button>
                )}
                <button disabled={busy} onClick={() => void backup()}>
                  Export backup…
                </button>
              </fieldset>
              <div className="dialog-buttons">
                <button onClick={() => setModal(null)}>OK</button>
              </div>
            </>
          )}
          {modal === "search" && (
            <>
              <input
                className="command-input"
                aria-label="Search workspace"
                autoFocus
                value={query}
                placeholder="Search pages, tasks, projects, or commands…"
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="search-results">
                {[
                  ["New page", () => newItem("page")],
                  ["New task", () => newItem("task")],
                  ["New project", () => newItem("project")],
                  ["Settings", () => setModal("settings")],
                  [
                    "Export backup",
                    () => {
                      void backup();
                      setModal(null);
                    },
                  ],
                ]
                  .filter(([label]) =>
                    (label as string)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map(([label, fn]) => (
                    <button key={label as string} onClick={fn as () => void}>
                      <Icon name="plus" size={16} />
                      <span>{label as string}</span>
                      <small>Command</small>
                    </button>
                  ))}
                {[
                  ...livePages.map((p) => ({
                    type: "page",
                    item: p,
                    text: p.text,
                  })),
                  ...liveProjects.map((p) => ({
                    type: "project",
                    item: p,
                    text: p.description,
                  })),
                  ...liveTasks.map((t) => ({
                    type: "task",
                    item: t,
                    text: t.text,
                  })),
                ]
                  .filter((r) =>
                    (r.item.title + " " + r.text)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .slice(0, 30)
                  .map((r) => (
                    <button
                      key={r.item.id}
                      onClick={() => {
                        go(r.type, r.item.id);
                        setModal(null);
                        setQuery("");
                      }}
                    >
                      <Icon
                        name={
                          r.type === "page"
                            ? "page"
                            : r.type === "task"
                              ? "tasks"
                              : "folder"
                        }
                        size={18}
                      />
                      <span>{r.item.title}</span>
                      <small>{r.type}</small>
                    </button>
                  ))}
              </div>
            </>
          )}
          {modal === "revisions" && (
            <>
              <p>
                Up to 20 checkpoints are kept. Restoring also checkpoints the
                current saved page.
              </p>
              <div className="revision-list">
                {snapshot.revisions
                  .filter((r) => r.pageId === page?.id)
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((r) => (
                    <div className="revision" key={r.id}>
                      <strong>{date(r.createdAt)}</strong>
                      <p>{r.text.slice(0, 160) || "Empty page"}</p>
                      <button
                        disabled={!canEdit}
                        onClick={async () => {
                          await flush();
                          if (
                            pending.current.size ||
                            getFailedMutations().length
                          )
                            return;
                          if (
                            await perform(() => actions.restoreRevision(r.id))
                          )
                            setModal(null);
                        }}
                      >
                        Restore this version
                      </button>
                    </div>
                  ))}
              </div>
            </>
          )}
          {modal === "import" && (
            <>
              <p>
                Restore a Desk95 ZIP backup, including pages, tasks, history,
                and attachments. Files are validated before changing your data.
              </p>
              <Field label="Backup ZIP file">
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => setBackupFile(e.target.files?.[0])}
                />
              </Field>
              <div className="import-actions">
                <button
                  disabled={!backupFile || busy || !canEdit}
                  onClick={() => void doImport("separate")}
                >
                  Import as separate workspace
                </button>
                <button disabled={busy} onClick={() => void backup()}>
                  Export current workspace first
                </button>
                <button
                  disabled={!backupFile || busy || !canEdit}
                  onClick={() => void doImport("replace")}
                >
                  Replace current workspace…
                </button>
              </div>
            </>
          )}
          {modal === "help" && (
            <>
              <div className="about-icon">
                <Icon name="computer" size={54} />
                <div>
                  <h2>Desk95</h2>
                  <p>A familiar place for new ideas.</p>
                </div>
              </div>
              <p>
                Keep your notes and tasks together. Create projects for an
                outcome, write the brief in a page, and select text to create
                linked tasks.
              </p>
              <p>
                <strong>⌘ / Ctrl K</strong> opens search and commands.{" "}
                <strong>⌘ / Ctrl S</strong> saves pending changes. Use Tab to
                navigate controls and Escape to dismiss panels.
              </p>
              <p>
                Drag tasks between columns, or change Status in task details.
                Open File to export a full ZIP backup; page Markdown exports
                contain text, not attachment files.
              </p>
              <p>
                Your data stays in this browser. Export backups regularly.
                Offline use becomes available after the production app has
                loaded once.
              </p>
              <div className="dialog-buttons">
                <button onClick={() => setModal(null)}>Back to work</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function TaskPanel({
  task,
  projects,
  pages,
  canEdit,
  onClose,
  onUpdate,
  onContent,
  onTrash,
  resolveAttachment,
}: {
  task: Task;
  projects: Project[];
  pages: Page[];
  canEdit: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onContent: (json: JSONContent, text: string) => void;
  onTrash: () => void;
  resolveAttachment: (id: string) => Promise<string | null>;
}) {
  const [subtask, setSubtask] = useState("");
  return (
    <aside className="task-panel" aria-label="Task details">
      <div className="panel-title">
        <span>D95-{task.id.slice(0, 4).toUpperCase()}</span>
        <button aria-label="Close task details" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="task-panel-scroll">
        <Field label="Task title">
          <input
            className="task-title"
            aria-label="Task title"
            defaultValue={task.title}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value.trim())
                onUpdate({ title: e.target.value.trim() });
            }}
          />
        </Field>
        <div className="task-fields">
          <Field label="Status">
            <select
              aria-label="Task status"
              disabled={!canEdit}
              value={task.status}
              onChange={(e) => onUpdate({ status: e.target.value as Status })}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              aria-label="Task priority"
              disabled={!canEdit}
              value={task.priority}
              onChange={(e) =>
                onUpdate({ priority: e.target.value as Priority })
              }
            >
              {priorities.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Project">
            <select
              aria-label="Task project"
              disabled={!canEdit}
              value={task.projectId || ""}
              onChange={(e) =>
                onUpdate({ projectId: e.target.value || undefined })
              }
            >
              <option value="">Inbox</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input
              aria-label="Task due date"
              type="date"
              disabled={!canEdit}
              value={task.dueDate || ""}
              onChange={(e) =>
                onUpdate({ dueDate: e.target.value || undefined })
              }
            />
          </Field>
        </div>
        <Field label="Labels (comma separated)">
          <input
            aria-label="Task labels"
            defaultValue={task.labels.join(", ")}
            disabled={!canEdit}
            onBlur={(e) =>
              onUpdate({
                labels: [
                  ...new Set(
                    e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  ),
                ],
              })
            }
          />
        </Field>
        <h2>Description</h2>
        <Editor
          content={task.description}
          editable={canEdit}
          onChange={onContent}
          pages={pages}
          resolveAttachment={resolveAttachment}
        />
        <h2>Subtasks</h2>
        {task.subtasks.map((st) => (
          <label className="subtask" key={st.id}>
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={st.done}
              onChange={(e) =>
                onUpdate({
                  subtasks: task.subtasks.map((s) =>
                    s.id === st.id ? { ...s, done: e.target.checked } : s,
                  ),
                })
              }
            />
            <span className={st.done ? "completed" : ""}>{st.title}</span>
            <button
              aria-label={"Remove subtask " + st.title}
              disabled={!canEdit}
              onClick={() =>
                onUpdate({
                  subtasks: task.subtasks.filter((s) => s.id !== st.id),
                })
              }
            >
              ×
            </button>
          </label>
        ))}
        <form
          className="subtask-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (subtask.trim()) {
              onUpdate({
                subtasks: [
                  ...task.subtasks,
                  {
                    id: crypto.randomUUID(),
                    title: subtask.trim(),
                    done: false,
                  },
                ],
              });
              setSubtask("");
            }
          }}
        >
          <input
            aria-label="New subtask"
            disabled={!canEdit}
            placeholder="Add a small next step…"
            value={subtask}
            onChange={(e) => setSubtask(e.target.value)}
          />
          <button disabled={!canEdit || !subtask.trim()}>Add</button>
        </form>
        <h2>Linked pages</h2>
        {task.pageIds.map((id) => {
          const p = pages.find((p) => p.id === id);
          return (
            p && (
              <div className="linked-page-row" key={id}>
                <a className="linked-page" href={"#/page/" + id}>
                  <Icon name="page" size={16} />
                  {p.title}
                </a>
                <button
                  aria-label={"Unlink page " + p.title}
                  disabled={!canEdit}
                  onClick={() =>
                    onUpdate({ pageIds: task.pageIds.filter((x) => x !== id) })
                  }
                >
                  ×
                </button>
              </div>
            )
          );
        })}
        <Field label="Link a page">
          <select
            aria-label="Link a page"
            disabled={!canEdit}
            value=""
            onChange={(e) => {
              if (e.target.value && !task.pageIds.includes(e.target.value))
                onUpdate({ pageIds: [...task.pageIds, e.target.value] });
            }}
          >
            <option value="">Choose a page…</option>
            {pages
              .filter((p) => !task.pageIds.includes(p.id))
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </Field>
        <div className="task-footer">
          <button disabled={!canEdit} onClick={onTrash}>
            <Icon name="trash" size={16} />
            Move to Trash
          </button>
        </div>
      </div>
    </aside>
  );
}
