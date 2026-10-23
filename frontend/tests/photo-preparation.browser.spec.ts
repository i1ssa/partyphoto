import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import sharp from "sharp";
import type { PhotoLimits } from "../src/lib/photo-preparation";

declare global { interface Window { photoPreparation: typeof import("../src/lib/photo-preparation"); } }

async function loadPreparation(page: Page) {
  await page.setContent("<main>Local photo preparation test</main>");
  const source = readFileSync(resolve(__dirname, "../src/lib/photo-preparation.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  await page.addScriptTag({ content: `(() => { const exports = {}; ${compiled}; window.photoPreparation = exports; })();` });
}

async function prepare(page: Page, buffer: Buffer, name: string, type: string, limits: PhotoLimits) {
  return page.evaluate(async ({ base64, name, type, limits }) => {
    const file = new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], name, { type, lastModified: 1234 });
    const signal = new AbortController().signal;
    const info = await window.photoPreparation.inspectPhoto(file, limits, signal);
    const result = await window.photoPreparation.reducePhoto(file, limits, signal);
    const output = new Uint8Array(await result.file.arrayBuffer());
    let binary = "";
    for (const byte of output) binary += String.fromCharCode(byte);
    return { info, sameFile: result.file === file, name: result.file.name, type: result.file.type, size: result.file.size, lastModified: result.file.lastModified, width: result.width, height: result.height, base64: btoa(binary) };
  }, { base64: buffer.toString("base64"), name, type, limits });
}

function withSingleImageMpf(jpeg: Buffer) {
  // A real MP Index IFD with Version, NumberOfImages and one 16-byte MPEntry.
  // Phone JPEGs can carry this metadata without containing an animation.
  const tiff = Buffer.alloc(66);
  tiff.write("MM", 0);
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(3, 8);
  tiff.writeUInt16BE(0xb000, 10);
  tiff.writeUInt16BE(7, 12);
  tiff.writeUInt32BE(4, 14);
  tiff.write("0100", 18);
  tiff.writeUInt16BE(0xb001, 22);
  tiff.writeUInt16BE(4, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt32BE(1, 30);
  tiff.writeUInt16BE(0xb002, 34);
  tiff.writeUInt16BE(7, 36);
  tiff.writeUInt32BE(16, 38);
  tiff.writeUInt32BE(50, 42);
  tiff.writeUInt32BE(0x20030000, 50);
  tiff.writeUInt32BE(jpeg.length + 74, 54);
  const payload = Buffer.concat([Buffer.from("MPF\0"), tiff]);
  const marker = Buffer.from([0xff, 0xe2, 0, 0]);
  marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]);
}

test("ordinary phone JPEG with MPF metadata stays unchanged or becomes a requested reduced copy", async ({ page }) => {
  await loadPreparation(page);
  const base = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#496357" } }).jpeg().toBuffer();
  const jpeg = withSingleImageMpf(base);
  const metadata = await sharp(jpeg, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata();
  expect(metadata.pages ?? 1).toBe(1);
  expect(metadata.width).toBe(4000);
  await expect(sharp(jpeg, { limitInputPixels: 40_000_000, failOn: "warning" }).rotate().resize({ width: 1200, height: 1200, fit: "inside" }).webp().toBuffer()).resolves.toBeInstanceOf(Buffer);

  const original = await prepare(page, jpeg, "phone-mpf.jpg", "image/jpeg", { maxUploadMb: 25, maxPixels: 40_000_000 });
  expect(original.sameFile).toBe(true);
  expect(Buffer.from(original.base64, "base64").equals(jpeg)).toBe(true);

  const copy = await prepare(page, jpeg, "phone-mpf.jpg", "image/jpeg", { maxUploadMb: 3, maxPixels: 6_000_000 });
  expect(copy.name).toBe("phone-mpf-small.jpg");
  expect(copy.sameFile).toBe(false);
  expect(copy.width * copy.height).toBeLessThanOrEqual(6_000_000);
  expect(copy.size).toBeLessThanOrEqual(3 * 1048576);
  const copyMetadata = await sharp(Buffer.from(copy.base64, "base64")).metadata();
  expect(copyMetadata.width).toBe(copy.width);
  expect(copyMetadata.height).toBe(copy.height);
});

test("12 MP phone JPEG becomes an explicitly named copy within demo caps, with EXIF orientation applied", async ({ page }) => {
  await loadPreparation(page);
  const buffer = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#315d62" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await prepare(page, buffer, "phone.jpg", "image/jpeg", { maxUploadMb: 3, maxPixels: 6_000_000 });
  expect(result.info.needsReduction).toBe(true);
  expect(result.sameFile).toBe(false);
  expect(result.name).toBe("phone-small.jpg");
  expect(result.lastModified).toBe(1234);
  expect(result.width).toBeLessThan(result.height);
  expect(result.width * result.height).toBeLessThanOrEqual(6_000_000);
  expect(result.size).toBeLessThanOrEqual(3 * 1048576);
  const metadata = await sharp(Buffer.from(result.base64, "base64")).metadata();
  expect(metadata.orientation).toBeUndefined();
  expect(metadata.width).toBe(result.width);
  expect(metadata.height).toBe(result.height);
});

test("files already within production limits remain byte-for-byte identical", async ({ page }) => {
  await loadPreparation(page);
  const buffer = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#529370" } }).jpeg().withMetadata().toBuffer();
  const result = await prepare(page, buffer, "original.jpg", "image/jpeg", { maxUploadMb: 25, maxPixels: 40_000_000 });
  expect(result.info.needsReduction).toBe(false);
  expect(result.sameFile).toBe(true);
  expect(result.name).toBe("original.jpg");
  expect(Buffer.from(result.base64, "base64").equals(buffer)).toBe(true);
});

test("transparent PNG stays transparent and byte-heavy JPEG respects the actual event byte limit", async ({ page }) => {
  await loadPreparation(page);
  const png = await sharp({ create: { width: 3200, height: 2400, channels: 4, background: { r: 90, g: 20, b: 30, alpha: 0.25 } } }).png().toBuffer();
  const result = await prepare(page, png, "transparent.png", "image/png", { maxUploadMb: 3, maxPixels: 6_000_000 });
  expect(result.type).toBe("image/png");
  const decoded = await sharp(Buffer.from(result.base64, "base64")).raw().toBuffer({ resolveWithObject: true });
  expect(decoded.info.channels).toBe(4);
  expect(decoded.data[3]).toBeGreaterThan(0);
  expect(decoded.data[3]).toBeLessThan(255);

  const noise = Buffer.alloc(1800 * 1200 * 3);
  let seed = 37;
  for (let i = 0; i < noise.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; noise[i] = seed & 255; }
  const jpeg = await sharp(noise, { raw: { width: 1800, height: 1200, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  expect(jpeg.length).toBeGreaterThan(0.5 * 1048576);
  const reduced = await prepare(page, jpeg, "noise.jpg", "image/jpeg", { maxUploadMb: 0.5, maxPixels: 40_000_000 });
  expect(reduced.size).toBeLessThanOrEqual(0.5 * 1048576);
  expect(reduced.info.needsReduction).toBe(true);
});

test("animated and disguised unsupported inputs cannot be converted, and cancellation rejects without decoding", async ({ page }) => {
  await loadPreparation(page);
  const pixels = Buffer.alloc(8 * 16 * 3, 255);
  pixels.fill(0, 0, 8 * 8 * 3);
  const animated = await sharp(pixels, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
  const outcomes = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const limits = { maxUploadMb: 0.00001, maxPixels: 1 };
    async function failure(file: File, signal = new AbortController().signal) {
      try { await window.photoPreparation.reducePhoto(file, limits, signal); return "unexpected success"; }
      catch (error) { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
    }
    const controller = new AbortController(); controller.abort();
    return {
      animated: await failure(new File([bytes], "animation.webp", { type: "image/webp" })),
      disguised: await failure(new File(["not a JPEG"], "fake.jpg", { type: "image/jpeg" })),
      heic: await failure(new File(["heic"], "phone.heic", { type: "image/heic" })),
      cancelled: await failure(new File([bytes], "cancel.webp", { type: "image/webp" }), controller.signal),
    };
  }, animated.toString("base64"));
  expect(outcomes.animated).toContain("без анимации");
  expect(outcomes.disguised).toContain("Не удалось прочитать");
  expect(outcomes.heic).toContain("HEIC");
  expect(outcomes.cancelled).toContain("AbortError");
});

test("guest chooses reduction explicitly, replacement selection cancels it, and only chosen copies upload", async ({ page }) => {
  test.setTimeout(60000);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname)) throw new Error("Upload fixtures require a local database");
  const db = new PrismaClient();
  const slug = `preparation-${randomUUID()}`;
  let userId: string | undefined, eventId: string | undefined;
  try {
    const user = await db.user.create({ data: { email: `${slug}@example.invalid`, name: "Подготовка фото", passwordHash: "test-unused" } });
    userId = user.id;
    const event = await db.event.create({ data: { ownerId: user.id, title: "Подготовка фото", slug, code: randomUUID().slice(0, 8).toUpperCase(), allowGuestUploads: true, maxUploadBytes: 16000 } });
    eventId = event.id;
    let posts = 0;
    let uploadedName = "";
    await page.route(`**/api/albums/${slug}/photos`, async route => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      uploadedName = route.request().postDataBuffer()?.toString("latin1").match(/filename="([^"]+)"/)?.[1] ?? "";
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Тестовый ответ: фото получено" }) });
    });
    await page.goto(`/e/${slug}`);
    const fileInput = page.getByLabel("Выберите фотографии", { exact: true });
    const large = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#719246" } }).jpeg().toBuffer();
    const small = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#374946" } }).jpeg().toBuffer();
    expect(large.length).toBeGreaterThan(16000);
    await fileInput.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: large });
    const reduce = page.getByRole("button", { name: "Уменьшить phone.jpg", exact: true });
    await expect(reduce).toBeVisible();
    await expect(page.getByRole("button", { name: "Загрузить фотографии", exact: true })).toBeDisabled();
    expect(posts).toBe(0);
    await reduce.click();
    await expect(page.getByText(/Уменьшенная копия ·/)).toBeVisible();
    expect(posts).toBe(0);
    await page.getByRole("button", { name: "Загрузить фотографии", exact: true }).click();
    await expect(page.getByText("Тестовый ответ: фото получено")).toBeVisible();
    expect(uploadedName).toBe("phone-small.jpg");
    expect(posts).toBe(1);

    await page.getByRole("button", { name: "Очистить выбор", exact: true }).click();
    await fileInput.setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: large });
    await expect(reduce).toBeVisible();
    await page.evaluate(() => {
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) { toBlob.call(this, blob => setTimeout(() => callback(blob), 700), ...args); };
    });
    await reduce.click();
    await fileInput.setInputFiles({ name: "replacement.jpg", mimeType: "image/jpeg", buffer: small });
    await expect(page.locator(".upload-file")).toHaveCount(1);
    await expect(page.locator(".upload-file")).toContainText("replacement.jpg");
    await expect(page.getByRole("button", { name: "Загрузить фотографии", exact: true })).toBeEnabled();
    await page.waitForTimeout(900);
    await expect(page.locator(".upload-file")).toContainText("replacement.jpg");
    await expect(page.getByText(/Уменьшенная копия ·/)).toHaveCount(0);
    await fileInput.setInputFiles(Array.from({ length: 21 }, (_, index) => ({ name: `photo-${index}.jpg`, mimeType: "image/jpeg", buffer: small })));
    await expect(page.getByText("За один раз можно загрузить до 20 фотографий. Выберите меньше файлов.")).toBeVisible();
    expect(posts).toBe(1);
  } finally {
    await page.goto("/").catch(() => {});
    if (eventId) await db.event.delete({ where: { id: eventId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
