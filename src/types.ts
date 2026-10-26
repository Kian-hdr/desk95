// Nested editor nodes are validated on import. Avoid recursive mapped paths in Dexie's update types.
export type Doc = {
  type: string;
  content?: any[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
};
export type Status = "Backlog" | "To do" | "In progress" | "Done";
export type Priority = "None" | "Low" | "Medium" | "High" | "Urgent";
export type Kind = "page" | "task" | "project";
export interface Base {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
export interface Workspace {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface Project extends Base {
  description: string;
  overviewPageId?: string;
}
export interface Page extends Base {
  projectId?: string;
  parentId?: string;
  content: Doc;
  text: string;
  favorite: boolean;
}
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}
export interface Task extends Base {
  description: Doc;
  text: string;
  status: Status;
  priority: Priority;
  labels: string[];
  dueDate?: string;
  projectId?: string;
  pageIds: string[];
  subtasks: Subtask[];
  order: number;
}
export interface Attachment {
  id: string;
  workspaceId: string;
  pageId: string;
  name: string;
  mime: string;
  size: number;
  blob: Blob;
  createdAt: number;
}
export interface Revision {
  id: string;
  workspaceId: string;
  pageId: string;
  content: Doc;
  text: string;
  title: string;
  createdAt: number;
}
export interface Preference {
  id: string;
  workspaceId: string;
  key: string;
  value: unknown;
}
export interface Snapshot {
  workspace: Workspace;
  projects: Project[];
  pages: Page[];
  tasks: Task[];
  attachments: Attachment[];
  revisions: Revision[];
  preferences: Preference[];
}
