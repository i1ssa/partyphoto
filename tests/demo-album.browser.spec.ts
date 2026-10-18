import { test, expect } from "@playwright/test";

test("homepage example opens a complete album without an account or album API", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Посмотреть пример", exact: true }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText("Пример альбома", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Галерея", exact: true })).toBeVisible();
  const photos = page.getByRole("button", { name: /^Открыть фотографию / });
  await expect(photos).toHaveCount(6);
  for (const photo of await photos.all()) {
    await photo.scrollIntoViewIfNeeded();
    const img = photo.locator("img");
    await expect(img).toHaveAttribute("src", /^\/demo-photos\/0[1-6]\.jpg$/);
    await expect.poll(() => img.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await expect(page.getByRole("link", { name: "Создать своё событие", exact: true })).toHaveAttribute("href", "/register");
  await expect(page.getByRole("link", { name: "На главную", exact: true })).toHaveAttribute("href", "/");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  const card = page.locator("article").first();
  const like = card.getByRole("button", { name: /лайк/ });
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await like.click();
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await expect(like).toContainText("1");
  await card.getByRole("button", { name: /^Открыть фотографию / }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  const previewLike = viewer.getByRole("button", { name: /лайк/ });
  await expect(previewLike).toHaveAttribute("aria-pressed", "true");
  await previewLike.click();
  await page.keyboard.press("Escape");
  await expect(like).toHaveAttribute("aria-pressed", "false");

  await like.click();
  await page.reload();
  await expect(like).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByText(/Лайки в примере сбрасываются/)).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("demo album fits narrow and wide screens in both themes", async ({ page }) => {
  await page.goto("/demo");
  for (const theme of ["light", "dark"] as const) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await page.getByRole("button", { name: theme === "dark" ? "Включить тёмную тему" : "Включить светлую тему", exact: true }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await expect(page.getByRole("heading", { name: "Галерея", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const card of await page.locator("article").all()) {
        const bounds = await card.boundingBox();
        const like = await card.getByRole("button", { name: /лайк/ }).boundingBox();
        expect(bounds).not.toBeNull();
        expect(like).not.toBeNull();
        expect(like!.x + like!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
      }
    }
  }
});
