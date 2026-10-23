/** Local inspection never decodes an oversized image just to read its dimensions. */
export type PhotoLimits = { maxUploadMb: number; maxPixels: number };
export type PhotoInspection = { width: number; height: number; type: string; needsReduction: boolean; canReduce: boolean };
export type PreparedPhoto = { file: File; width: number; height: number };

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 50_000_000;
const MAX_SOURCE_SIDE = 16_384;
const FORMATS = ["image/jpeg", "image/png", "image/webp"];
const unreadable = () => new Error("Не удалось прочитать фотографию. Выберите другой JPEG, PNG или WebP.");
const animated = () => new Error("Выберите обычную фотографию без анимации.");

function check(signal: AbortSignal) { signal.throwIfAborted(); }

async function bytes(file: File, start: number, length: number, signal: AbortSignal) {
  check(signal);
  if (start < 0 || length < 0 || start + length > file.size) throw unreadable();
  const buffer = await file.slice(start, start + length).arrayBuffer();
  check(signal);
  return new DataView(buffer);
}

function tag(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");
}

async function dimensions(file: File, signal: AbortSignal): Promise<{ width: number; height: number; type: string }> {
  const head = await bytes(file, 0, Math.min(32, file.size), signal);
  if (head.byteLength >= 24 && head.getUint32(0) === 0x89504e47 && head.getUint32(4) === 0x0d0a1a0a) {
    let width = 0, height = 0, offset = 8;
    for (let count = 0; count < 4096 && offset + 12 <= file.size; count++) {
      const chunk = await bytes(file, offset, 8, signal);
      const length = chunk.getUint32(0), name = tag(chunk, 4, 4);
      if (offset + length + 12 > file.size) throw unreadable();
      if (name === "acTL" || name === "fcTL" || name === "fdAT") throw animated();
      if (offset === 8) {
        if (name !== "IHDR" || length !== 13) throw unreadable();
        width = head.getUint32(16); height = head.getUint32(20);
      }
      if (name === "IEND") {
        if (length !== 0 || offset + 12 !== file.size) throw unreadable();
        return { width, height, type: "image/png" };
      }
      offset += length + 12;
    }
    throw unreadable();
  }
  if (head.byteLength >= 20 && tag(head, 0, 4) === "RIFF" && tag(head, 8, 4) === "WEBP") {
    if (head.getUint32(4, true) + 8 !== file.size) throw unreadable();
    let width = 0, height = 0, offset = 12;
    for (let count = 0; count < 4096 && offset + 8 <= file.size; count++) {
      const chunk = await bytes(file, offset, 8, signal);
      const name = tag(chunk, 0, 4), length = chunk.getUint32(4, true);
      if (offset + 8 + length > file.size) throw unreadable();
      if (name === "ANIM" || name === "ANMF") throw animated();
      if (name === "VP8X") {
        if (length !== 10) throw unreadable();
        const data = await bytes(file, offset + 8, 10, signal);
        if (data.getUint8(0) & 2) throw animated();
        width = 1 + data.getUint8(4) + (data.getUint8(5) << 8) + (data.getUint8(6) << 16);
        height = 1 + data.getUint8(7) + (data.getUint8(8) << 8) + (data.getUint8(9) << 16);
      } else if (name === "VP8 " && !width) {
        const data = await bytes(file, offset + 8, 10, signal);
        if (length < 10 || data.getUint8(3) !== 0x9d || data.getUint8(4) !== 1 || data.getUint8(5) !== 0x2a) throw unreadable();
        width = data.getUint16(6, true) & 0x3fff; height = data.getUint16(8, true) & 0x3fff;
      } else if (name === "VP8L" && !width) {
        const data = await bytes(file, offset + 8, 5, signal);
        if (length < 5 || data.getUint8(0) !== 0x2f) throw unreadable();
        const bits = data.getUint32(1, true);
        width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1;
      }
      offset += 8 + length + (length % 2);
    }
    if (offset !== file.size) throw unreadable();
    return { width, height, type: "image/webp" };
  }
  if (head.byteLength >= 4 && head.getUint16(0) === 0xffd8) {
    let width = 0, height = 0, offset = 2;
    // JPEG metadata precedes scan data. Bound its size and marker count.
    for (let count = 0; count < 4096 && offset < Math.min(file.size, 2 * 1024 * 1024); count++) {
      const marker = await bytes(file, offset, 2, signal);
      if (marker.getUint8(0) !== 0xff) throw unreadable();
      const type = marker.getUint8(1);
      if (type === 0xff) { offset++; continue; }
      if (type === 0xda && width && height) return { width, height, type: "image/jpeg" };
      if (type === 0xd9 || type === 0x00) throw unreadable();
      const size = await bytes(file, offset + 2, 2, signal);
      const length = size.getUint16(0);
      if (length < 2 || offset + 2 + length > file.size) throw unreadable();
      if ([0xc0, 0xc1, 0xc2].includes(type)) {
        if (length < 8) throw unreadable();
        const frame = await bytes(file, offset + 4, 5, signal);
        height = frame.getUint16(1); width = frame.getUint16(3);
      }
      // MPF metadata also occurs in ordinary phone JPEGs (HDR/depth); it is not
      // evidence of animation. Keep metadata untouched unless a copy is requested.
      offset += length + 2;
    }
  }
  throw unreadable();
}

export async function inspectPhoto(file: File, limits: PhotoLimits, signal: AbortSignal): Promise<PhotoInspection> {
  if (!file.size) throw new Error("Файл пуст. Выберите другую фотографию.");
  if ((!FORMATS.includes(file.type) && file.type) || (!file.type && !/\.(jpe?g|png|webp)$/i.test(file.name))) {
    throw new Error("Поддерживаются только JPEG, PNG и WebP. Для HEIC сначала сохраните снимок как JPEG на устройстве.");
  }
  const info = await dimensions(file, signal);
  if (file.type && file.type !== info.type) throw unreadable();
  if (!info.width || !info.height) throw unreadable();
  return {
    ...info,
    needsReduction: file.size > limits.maxUploadMb * 1048576 || info.width * info.height > limits.maxPixels,
    canReduce: file.size <= MAX_SOURCE_BYTES && info.width * info.height <= MAX_SOURCE_PIXELS && Math.max(info.width, info.height) <= MAX_SOURCE_SIDE,
  };
}

async function loadPhoto(file: File, signal: AbortSignal): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const photo = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { photo.onload = null; photo.onerror = null; signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); photo.src = ""; reject(new DOMException("Aborted", "AbortError")); };
      photo.onload = () => { cleanup(); resolve(); };
      photo.onerror = () => { cleanup(); reject(unreadable()); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) return abort();
      photo.src = url;
    });
    check(signal);
    return photo;
  } finally { URL.revokeObjectURL(url); }
}

/** Called only after the user explicitly chooses to create a reduced copy. */
export async function reducePhoto(file: File, limits: PhotoLimits, signal: AbortSignal): Promise<PreparedPhoto> {
  const info = await inspectPhoto(file, limits, signal);
  if (!info.needsReduction) return { file, width: info.width, height: info.height };
  if (!info.canReduce) throw new Error("Фото слишком большое для обработки в браузере. Уменьшите его на устройстве и выберите снова (до 50 Мп и 64 МБ).");
  // HTMLImageElement applies EXIF orientation before drawing; use its oriented dimensions.
  const photo = await loadPhoto(file, signal);
  const canvas = document.createElement("canvas");
  try {
    if (!photo.naturalWidth || !photo.naturalHeight || photo.naturalWidth * photo.naturalHeight > MAX_SOURCE_PIXELS) throw unreadable();
    let scale = Math.min(1, 4096 / Math.max(photo.naturalWidth, photo.naturalHeight), Math.sqrt(Math.min(limits.maxPixels, 12_000_000) / (photo.naturalWidth * photo.naturalHeight)));
    const maxBytes = limits.maxUploadMb * 1048576;
    // Sequential, bounded encodes prevent multiple large canvases from accumulating.
    for (let attempt = 0; attempt < 10; attempt++) {
      check(signal);
      canvas.width = Math.max(1, Math.floor(photo.naturalWidth * scale));
      canvas.height = Math.max(1, Math.floor(photo.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Браузер не смог уменьшить фото. Попробуйте другое фото или устройство.");
      context.drawImage(photo, 0, 0, canvas.width, canvas.height);
      const quality = Math.max(0.72, 0.9 - attempt * 0.06);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, info.type, quality));
      check(signal);
      if (!blob?.size || !FORMATS.includes(blob.type)) throw unreadable();
      if (blob.size <= maxBytes) {
        const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
        const name = `${file.name.replace(/\.[^.]+$/, "")}-small.${extension}`;
        return { file: new File([blob], name, { type: blob.type, lastModified: file.lastModified }), width: canvas.width, height: canvas.height };
      }
      scale *= Math.min(0.85, Math.sqrt(maxBytes / blob.size) * 0.92);
    }
    throw new Error("Не удалось уложиться в лимит альбома. Уменьшите фото на устройстве или выберите другое.");
  } finally {
    photo.src = "";
    canvas.width = 0;
    canvas.height = 0;
  }
}
