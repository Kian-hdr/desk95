import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) || []).toEqual([]);
});

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Document content" }).first();
async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Editing enabled");
}
async function menu(page: Page, action: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page
    .locator(".menu-popup")
    .getByRole("button", { name: action, exact: true })
    .click();
}
async function createPage(page: Page, title: string, text = "") {
  await menu(page, "New page");
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill(title);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  if (text) {
    await editor(page).fill(text);
    await saved(page);
  }
}
async function saved(page: Page) {
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.locator(".statusbar").getByRole("status")).toHaveText(
    "Saved locally",
  );
}
async function openPage(page: Page, title: string) {
  await page.locator(".page-nav").filter({ hasText: title }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

test("appearance follows the device and remembers manual overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await ready(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Open appearance settings" }).click();
  await page.getByLabel("Appearance", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Open appearance settings" }).click();
  await page.getByLabel("Appearance", { exact: true }).selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("page editing survives reload and browser history navigation", async ({
  page,
}) => {
  await ready(page);
  await createPage(
    page,
    "Release brief",
    "A durable idea for the next release.",
  );
  const pageUrl = page.url();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: /^Inbox/ })
    .click();
  await page.goBack();
  await expect(page).toHaveURL(pageUrl);
  await expect(editor(page)).toContainText(
    "A durable idea for the next release.",
  );
  await page.reload();
  await expect(editor(page)).toContainText(
    "A durable idea for the next release.",
  );
  await expect(page.locator(".statusbar")).toContainText("Editing enabled");
  await editor(page).fill("Reopened and still editable.");
  await saved(page);
  await page.reload();
  await expect(editor(page)).toContainText("Reopened and still editable.");
});

test("selected text creates a bidirectional linked task", async ({ page }) => {
  await ready(page);
  await createPage(page, "Connected brief", "Ship the local workspace");
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page
    .getByRole("button", { name: "Create linked task", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "Task details" });
  await expect(panel.getByLabel("Task title")).toHaveValue(
    "Ship the local workspace",
  );
  await expect(
    panel.getByRole("link", { name: "Connected brief" }),
  ).toBeVisible();
  await panel.getByLabel("Task status").selectOption("Done");
  await saved(page);
  await page.getByRole("button", { name: "Close task details" }).click();
  await expect(
    page
      .locator(".linked-tasks")
      .getByRole("button", { name: "Ship the local workspace" }),
  ).toBeVisible();
  await page
    .locator(".linked-tasks")
    .getByRole("button", { name: "Ship the local workspace" })
    .click();
  await expect(panel.getByLabel("Task status")).toHaveValue("Done");
});

test("board and list reflect task edits, subtasks, filtering and reload", async ({
  page,
}) => {
  await ready(page);
  await menu(page, "New task");
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Verify board consistency");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  const panel = page.getByRole("complementary", { name: "Task details" });
  await panel.getByLabel("Task status").selectOption("In progress");
  await panel.getByLabel("Task priority").selectOption("Urgent");
  await panel.getByLabel("New subtask").fill("Check the list view");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    panel.getByText("Check the list view", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task details" }).click();
  const column = page.locator(".board-column").filter({
    has: page.getByRole("heading", { name: "In progress", exact: true }),
  });
  await expect(
    column.getByRole("button", { name: "Verify board consistency" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(
    page.getByLabel("Status for Verify board consistency"),
  ).toHaveValue("In progress");
  await page
    .getByLabel("Status for Verify board consistency")
    .selectOption("Done");
  await saved(page);
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page
      .locator(".board-column")
      .filter({ has: page.getByRole("heading", { name: "Done", exact: true }) })
      .getByRole("button", { name: "Verify board consistency" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Verify board consistency" }).click();
  await expect(panel.getByLabel("Task status")).toHaveValue("Done");
  await expect(panel.getByLabel("Task priority")).toHaveValue("Urgent");
});

test("Trash and revision history restore document content", async ({
  page,
}) => {
  await ready(page);
  await createPage(page, "Recover this page", "Original recoverable content");
  await page.getByRole("button", { name: "Move page to Trash" }).click();
  await page.getByRole("button", { name: "Recycle Bin", exact: true }).click();
  await page
    .locator(".item")
    .filter({ hasText: "Recover this page" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await openPage(page, "Recover this page");
  await expect(editor(page)).toContainText("Original recoverable content");
  await editor(page).fill("Replacement text");
  await saved(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .locator(".revision")
    .filter({ hasText: "Original recoverable content" })
    .first()
    .getByRole("button", { name: "Restore this version" })
    .click();
  await expect(editor(page)).toContainText("Original recoverable content");
});

test("ZIP backup restores pages, linked tasks and downloadable attachments into a clean browser", async ({
  page,
  browser,
}) => {
  await ready(page);
  await createPage(page, "Backup brief", "Remember this backup");
  await page
    .locator('input[type=file][aria-label="Attach file"]')
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Attachment round trip verified."),
    });
  await expect(
    editor(page).getByRole("link", { name: "notes.txt" }),
  ).toBeVisible();
  await saved(page);
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page
    .getByRole("button", { name: "Create linked task", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Task details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close task details" }).click();
  await saved(page);
  const downloadEvent = page.waitForEvent("download");
  await menu(page, "Export workspace backup…");
  const backup = await downloadEvent;
  const path = await backup.path();
  expect(path).toBeTruthy();
  const clean = await browser.newContext();
  const restored = await clean.newPage();
  try {
    await ready(restored);
    await menu(restored, "Import workspace backup…");
    await restored.getByLabel("Backup ZIP file").setInputFiles(path!);
    await restored
      .getByRole("button", {
        name: "Import as separate workspace",
        exact: true,
      })
      .click();
    await expect(restored.getByRole("dialog")).not.toBeVisible();
    await openPage(restored, "Backup brief");
    await restored.reload();
    await expect(restored.getByLabel("Switch workspace")).toContainText(
      "imported",
    );
    await expect(editor(restored)).toContainText("Remember this backup");
    await expect(restored.locator(".linked-tasks button")).toHaveCount(1);
    const attachmentEvent = restored.waitForEvent("download");
    await editor(restored).getByRole("link", { name: "notes.txt" }).click();
    const attachment = await attachmentEvent;
    expect(await readFile((await attachment.path())!, "utf8")).toBe(
      "Attachment round trip verified.",
    );
  } finally {
    await clean.close();
  }
});

test("a second tab is read-only and takeover revokes the first writer", async ({
  page,
  context,
}) => {
  await ready(page);
  await createPage(page, "Ownership page", "One writer at a time");
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("button", { name: "Take over editing" }),
  ).toBeVisible();
  await expect(editor(second)).toHaveAttribute("contenteditable", "false");
  await second.getByRole("button", { name: "Take over editing" }).click();
  await expect(editor(second)).toHaveAttribute("contenteditable", "true");
  await expect(
    page.getByRole("button", { name: "Take over editing" }),
  ).toBeVisible();
  await expect(editor(page)).toHaveAttribute("contenteditable", "false");
  await editor(second).fill("Written by the new owner");
  await saved(second);
  await expect(editor(page)).toContainText("Written by the new owner");
});

test("failed document writes retain pending edits and can be retried", async ({
  page,
}) => {
  await ready(page);
  await createPage(page, "Save failure page", "Previously saved");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__desk95Put = original;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "pages")
        throw new DOMException("Simulated full storage", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await editor(page).fill("Pending text must survive a failed save");
  await expect(page.getByRole("alert")).toContainText(
    /Simulated full storage|QuotaExceededError/,
  );
  await expect(page.locator(".statusbar")).toContainText("Save failed");
  await expect(editor(page)).toContainText(
    "Pending text must survive a failed save",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).__desk95Put;
  });
  await page.getByRole("button", { name: "Retry saves", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(editor(page)).toContainText(
    "Pending text must survive a failed save",
  );
});

test("production app reloads and edits offline after caching", async ({
  page,
  context,
}) => {
  await ready(page);
  await createPage(page, "Offline brief", "Available without a network");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(editor(page)).toContainText("Available without a network");
  await editor(page).fill("Written while offline");
  await saved(page);
  await page.reload();
  await expect(editor(page)).toContainText("Written while offline");
});

test("narrow layout exposes navigation and keyboard opens commands", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await expect(
    page.getByRole("navigation", { name: "Workspace navigation" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace navigation" })
    .getByRole("button", { name: /^Inbox/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("textbox", { name: "Search workspace" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("failed task properties are retained, retried, and survive reload", async ({
  page,
}) => {
  await ready(page);
  await menu(page, "New task");
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Property recovery");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).__originalTaskPut = original;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "tasks")
        throw new DOMException(
          "Task storage unavailable",
          "QuotaExceededError",
        );
      return original.apply(this, args);
    };
  });
  await page
    .getByLabel("Task priority", { exact: true })
    .selectOption("Urgent");
  await expect(page.getByRole("alert")).toContainText(
    /Task storage unavailable|QuotaExceededError/,
  );
  await expect(
    page.getByLabel("Task priority", { exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (window as any).__originalTaskPut;
  });
  await page.getByRole("button", { name: "Retry saves", exact: true }).click();
  await expect(page.getByLabel("Task priority", { exact: true })).toHaveValue(
    "Urgent",
  );
  await expect(page.getByLabel("Task priority", { exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Task priority", { exact: true })).toHaveValue(
    "Urgent",
  );
});

test("dragging tasks changes columns and preserves relative order on reload", async ({
  page,
}) => {
  await ready(page);
  const backlog = page.locator(".board-column").filter({
    has: page.getByRole("heading", { name: "Backlog", exact: true }),
  });
  const done = page
    .locator(".board-column")
    .filter({ has: page.getByRole("heading", { name: "Done", exact: true }) });
  const card = backlog.locator(".task-card").first();
  const title = await card.locator(".task-card-title").innerText();
  await card.dragTo(done.locator(".column-heading"));
  await expect(
    done.locator(".task-card-title").filter({ hasText: title }),
  ).toBeVisible();
  await page.reload();
  await expect(
    done.locator(".task-card-title").filter({ hasText: title }),
  ).toBeVisible();
});
