import { test as base, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import sharp from "sharp";

const test = base.extend<{ viewerAlbum: { slug: string; eventId: string } }>({
  viewerAlbum: async ({ page, context }, use) => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) throw new Error("Viewer tests require local PostgreSQL");
    const db = new PrismaClient();
    const slug = `viewer-${randomUUID()}`;
    let userId: string | undefined;
    let eventId: string | undefined;
    try {
      const user = await db.user.create({ data: {
        email: `${slug}@example.invalid`, name: "Проверка просмотра",
        passwordHash: await argon2.hash(randomBytes(24).toString("hex"), { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      } });
      userId = user.id;
      const event = await db.event.create({ data: { ownerId: user.id, title: "Альбом для просмотра", slug, code: randomBytes(4).toString("hex").toUpperCase() } });
      eventId = event.id;
      await db.photo.createMany({ data: Array.from({ length: 42 }, (_, index) => ({
        eventId: event.id, filename: `memory-${index + 1}.jpg`, originalKey: `${slug}/${index}.jpg`, thumbnailKey: `${slug}/thumb-${index}.jpg`,
        mimeType: "image/jpeg", sizeBytes: 128, width: 800, height: 600, status: "PUBLISHED" as const,
        createdAt: new Date(Date.now() - index * 60000),
      })) });
      // Keep real gallery pagination/likes and replace only unavailable S3 images.
      const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#b5bc9b" } }).jpeg().toBuffer();
      await page.route("**/api/photos/*/thumbnail", route => route.fulfill({ contentType: "image/jpeg", body: jpeg }));
      await use({ slug, eventId: event.id });
    } finally {
      await page.goto("/").catch(() => {});
      const visitors = (await context.cookies()).filter(cookie => cookie.name === "partyphoto_visitor")
        .map(cookie => createHash("sha256").update(`visitor:${cookie.value}`).digest("hex"));
      try {
        if (eventId) {
          await db.photo.deleteMany({ where: { eventId } });
          await db.event.deleteMany({ where: { id: eventId, ownerId: userId } });
        }
        if (userId) await db.user.deleteMany({ where: { id: userId, email: `${slug}@example.invalid` } });
        await db.authRateLimit.deleteMany({ where: { key: { in: [
          ...visitors.flatMap(hash => [`view:visitor:${hash}`, `like:voter:${hash}`]),
          ...(eventId ? [`view:event:${eventId}`, `like:event:${eventId}`] : []),
        ] } } });
      } finally { await db.$disconnect(); }
    }
  },
});

test("viewer retries a failed next page, reaches the real album end, and preserves photo actions", async ({ page, viewerAlbum }) => {
  let failNext = true;
  await page.route(`**/api/albums/${viewerAlbum.slug}/photos?cursor=*`, async route => {
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Следующая страница временно недоступна." }) });
    } else await route.continue();
  });
  await page.goto(`/e/${viewerAlbum.slug}`);
  const cards = page.locator(".photo-grid .photo-preview-button");
  await expect(cards).toHaveCount(40);
  const opener = cards.last();
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("40 из 42", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Следующая фотография", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Следующая страница временно недоступна.");
  await expect(dialog.getByText("40 из 42", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Следующая фотография", exact: true }).click();
  await expect(dialog.getByText("41 из 42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Следующая фотография", exact: true }).click();
  await expect(dialog.getByText("42 из 42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Следующая фотография", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Слайд-шоу", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Поставить лайк memory-42.jpg", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Убрать лайк memory-42.jpg", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("link", { name: /Скачать оригинал/ })).toHaveAttribute("download", "memory-42.jpg");
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText("41 из 42", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(cards).toHaveCount(42);
  await expect(page.getByRole("button", { name: "Открыть фотографию memory-40.jpg", exact: true })).toBeFocused();
});

test("keyboard focus stays in the dialog and mobile swipes leave vertical gestures alone", async ({ page, viewerAlbum }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/e/${viewerAlbum.slug}`);
  const opener = page.getByRole("button", { name: "Открыть фотографию memory-1.jpg", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Закрыть просмотр фотографии", exact: true })).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Предыдущая фотография", exact: true })).toBeDisabled();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);
  }
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("2 из 42", { exact: true })).toBeVisible();
  const stage = dialog.locator("[data-photo-viewer-stage]");
  await stage.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 250, clientY: 100 }] });
  await stage.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 245, clientY: 220 }] });
  await expect(dialog.getByText("2 из 42", { exact: true })).toBeVisible();
  await stage.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 250, clientY: 100 }] });
  await stage.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 90, clientY: 110 }] });
  await expect(dialog.getByText("3 из 42", { exact: true })).toBeVisible();
  await stage.dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 90, clientY: 100 }] });
  await stage.dispatchEvent("touchend", { touches: [], changedTouches: [{ identifier: 1, clientX: 250, clientY: 110 }] });
  await expect(dialog.getByText("2 из 42", { exact: true })).toBeVisible();
  expect(await stage.evaluate(element => getComputedStyle(element).touchAction)).toContain("pan-y");
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("viewer-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("slideshow starts only on request, pauses when hidden, loads later pages, and stops at the end", async ({ page, viewerAlbum }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(`/e/${viewerAlbum.slug}`);
  await page.getByRole("button", { name: "Открыть фотографию memory-40.jpg", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("img")).toHaveJSProperty("complete", true);
  await page.clock.fastForward(5000);
  await expect(dialog.getByText("40 из 42", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Слайд-шоу", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Пауза", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dialog.getByRole("button", { name: "Слайд-шоу", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.clock.fastForward(5000);
  await expect(dialog.getByText("40 из 42", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await dialog.getByRole("button", { name: "Слайд-шоу", exact: true }).click();
  await page.clock.fastForward(4100);
  await expect(dialog.getByText("41 из 42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveJSProperty("complete", true);
  await page.clock.fastForward(4100);
  await expect(dialog.getByText("42 из 42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Слайд-шоу", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.clock.fastForward(5000);
  await expect(dialog.getByText("42 из 42", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Предыдущая фотография", exact: true }).click();
  await dialog.getByRole("button", { name: "Слайд-шоу", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Открыть фотографию memory-1.jpg", exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(dialog.getByText("1 из 42", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Слайд-шоу", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("liking during ranked viewing keeps the dialog open and refreshes the ranking on close", async ({ page, viewerAlbum }) => {
  await page.goto(`/e/${viewerAlbum.slug}`);
  await page.getByRole("button", { name: "По лайкам", exact: true }).click();
  const cards = page.locator(".photo-grid .photo-preview-button");
  await expect(cards).toHaveCount(40);
  await page.getByRole("button", { name: "Открыть фотографию memory-2.jpg", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Поставить лайк memory-2.jpg", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Убрать лайк memory-2.jpg", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByText("2 из 42", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText("3 из 42", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cards.first()).toHaveAttribute("aria-label", "Открыть фотографию memory-2.jpg");
});

test("pausing while the next page is loading prevents a late slideshow advance", async ({ page, viewerAlbum }) => {
  let release: () => void = () => {};
  let announce: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { announce = resolve; });
  await page.route(`**/api/albums/${viewerAlbum.slug}/photos?cursor=*`, async route => {
    const response = await route.fetch();
    announce();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.clock.install();
    await page.goto(`/e/${viewerAlbum.slug}`);
    await page.getByRole("button", { name: "Открыть фотографию memory-40.jpg", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("img")).toHaveJSProperty("complete", true);
    await dialog.getByRole("button", { name: "Слайд-шоу", exact: true }).click();
    await page.clock.fastForward(4100);
    await held;
    await expect(dialog.getByText("Загружаем следующие фотографии…", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Пауза", exact: true }).click();
    release();
    await expect(page.locator(".photo-grid .photo-preview-button")).toHaveCount(42);
    await page.clock.fastForward(5000);
    await expect(dialog.getByText("40 из 42", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Слайд-шоу", exact: true })).toHaveAttribute("aria-pressed", "false");
  } finally { release(); }
});
