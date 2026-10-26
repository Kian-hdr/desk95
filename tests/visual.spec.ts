import { test, expect } from "@playwright/test";
test("desktop light/dark and mobile surfaces render without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Editing enabled");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('13px "W95FA"'))).toBe(
    true,
  );
  expect(
    await page
      .locator("body")
      .evaluate((el) => getComputedStyle(el).fontFamily),
  ).toContain("W95FA");
  await page.screenshot({ path: "output/playwright/desk95-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "output/playwright/desk95-dark.png" });
  await page.locator(".page-nav").first().click();
  await expect(
    page.getByRole("textbox", { name: "Document content" }),
  ).toBeVisible();
  await page.screenshot({ path: "output/playwright/desk95-editor.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "output/playwright/desk95-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
