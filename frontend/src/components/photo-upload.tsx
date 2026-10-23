"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { photoFileError, uploadPhotoFile } from "@/lib/photo-upload-client";
import { inspectPhoto, reducePhoto } from "@/lib/photo-preparation";
import { PhotoCamera } from "@/components/photo-camera";
import { UiIcon } from "@/components/ui-icon";
import styles from "./photo-upload.module.css";

type UploadItem = { file: File; status: "checking" | "needs-reduction" | "preparing" | "ready" | "uploading" | "uploaded" | "error"; message?: string; retryable?: boolean; copyNotice?: string };
type PhotoUploadProps = { endpoint: string; maxUploadMb: number; maxPixels: number; guest?: boolean; compact?: boolean; onUploaded: () => void };

export function PhotoUpload({ endpoint, maxUploadMb, maxPixels, guest = false, compact = false, onUploaded }: PhotoUploadProps) {
  const router = useRouter();
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadForm = useRef<HTMLFormElement>(null);
  const scrollToSelection = useRef(false);
  const cameraTrigger = useRef<HTMLButtonElement>(null);
  const uploading = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const preparing = useRef(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [batch, setBatch] = useState({ completed: 0, total: 0 });
  const compactGuest = guest && compact;
  const uploadable = items.filter((item) => item.status === "ready" || (item.status === "error" && item.retryable));
  const reducible = items.filter((item) => item.status === "needs-reduction");
  const processing = items.some((item) => item.status === "checking" || item.status === "preparing");
  const busy = pending || processing;

  useEffect(() => () => { controller.current?.abort(); preparation.current?.abort(); generation.current++; }, []);

  useEffect(() => {
    if (!compactGuest || !scrollToSelection.current || !uploadForm.current || uploadForm.current.hidden) return;
    const frame = requestAnimationFrame(() => {
      scrollToSelection.current = false;
      fileInput.current?.focus({ preventScroll: true });
      uploadForm.current?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [compactGuest, items, error]);

  async function selectFiles(files: FileList | null) {
    if (uploading.current) return;
    preparation.current?.abort();
    preparation.current = new AbortController();
    const signal = preparation.current.signal;
    const request = ++generation.current;
    preparing.current = false;
    setError("");
    setCameraMessage("");
    setBatch({ completed: 0, total: 0 });
    if (!files) { setItems([]); return; }
    scrollToSelection.current = compactGuest && files.length > 0;
    if (files.length > 20) {
      setError("За один раз можно загрузить до 20 фотографий. Выберите меньше файлов.");
      setItems([]);
      return;
    }
    const selected = Array.from(files);
    setItems(selected.map((file) => ({ file, status: "checking" })));
    for (const [index, file] of selected.entries()) {
      try {
        const info = await inspectPhoto(file, { maxUploadMb, maxPixels }, signal);
        if (request !== generation.current || signal.aborted) return;
        const item: UploadItem = info.needsReduction
          ? info.canReduce
            ? { file, status: "needs-reduction", message: `Фото ${info.width} × ${info.height} превышает лимит альбома. Можно создать уменьшенную копию.` }
            : { file, status: "error", message: "Фото слишком большое для обработки в браузере. Уменьшите его на устройстве (до 50 Мп и 64 МБ)." }
          : { file, status: "ready" };
        setItems((current) => current.map((entry, position) => position === index ? item : entry));
      } catch (failure) {
        if (request !== generation.current || signal.aborted) return;
        setItems((current) => current.map((entry, position) => position === index ? { file, status: "error", message: failure instanceof Error ? failure.message : "Не удалось прочитать фотографию." } : entry));
      }
    }
  }

  function clearSelection() {
    if (uploading.current) return;
    preparation.current?.abort();
    generation.current++;
    preparing.current = false;
    setItems([]);
    setError("");
    setBatch({ completed: 0, total: 0 });
    if (fileInput.current) fileInput.current.value = "";
  }

  async function prepareFiles(selectedIndex?: number) {
    if (uploading.current || preparing.current || processing) return;
    const targets = items.map((item, index) => ({ ...item, index })).filter((item) => item.status === "needs-reduction" && (selectedIndex === undefined || selectedIndex === item.index));
    if (!targets.length) return;
    preparation.current?.abort();
    preparation.current = new AbortController();
    const signal = preparation.current.signal;
    const request = ++generation.current;
    preparing.current = true;
    try {
      for (const item of targets) {
        setItems((current) => current.map((entry, index) => index === item.index ? { ...entry, status: "preparing", message: undefined } : entry));
        try {
          const result = await reducePhoto(item.file, { maxUploadMb, maxPixels }, signal);
          if (request !== generation.current || signal.aborted) return;
          setItems((current) => current.map((entry, index) => index === item.index ? { file: result.file, status: "ready", copyNotice: `Уменьшенная копия · ${result.width} × ${result.height}. Исходный файл на устройстве не изменён.` } : entry));
        } catch (failure) {
          if (request !== generation.current || signal.aborted) return;
          setItems((current) => current.map((entry, index) => index === item.index ? { ...entry, status: "needs-reduction", message: failure instanceof Error ? failure.message : "Не удалось уменьшить фото. Попробуйте ещё раз." } : entry));
        }
      }
    } finally { if (request === generation.current) preparing.current = false; }
  }

  function openCamera() {
    if (uploading.current || processing || preparing.current) return;
    setCameraMessage("");
    setCameraOpen(true);
  }

  function closeCamera() {
    setCameraOpen(false);
    requestAnimationFrame(() => cameraTrigger.current?.focus());
  }

  async function uploadCapture(file: File) {
    if (uploading.current) throw new Error("Дождитесь завершения текущей загрузки.");
    const message = photoFileError(file, maxUploadMb);
    if (message) throw new Error(message);
    uploading.current = true;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setPending(true);
    try {
      await uploadPhotoFile(endpoint, file, signal);
      if (!signal.aborted) {
        setCameraMessage("Снимок добавлен в альбом.");
        onUploaded();
        router.refresh();
      }
    } finally {
      uploading.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading.current || processing || preparing.current) return;
    const targets = items.map((item, index) => ({ ...item, index })).filter((item) => item.status === "ready" || (item.status === "error" && item.retryable));
    if (!targets.length) {
      setError("Выберите фотографии в формате JPEG, PNG или WebP.");
      return;
    }
    uploading.current = true;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setPending(true);
    setError("");
    setCameraMessage("");
    setBatch({ completed: 0, total: targets.length });
    let uploaded = 0;

    for (const [position, item] of targets.entries()) {
      if (signal.aborted) break;
      setItems((current) => current.map((entry, index) => index === item.index ? { ...entry, status: "uploading", message: undefined } : entry));
      try {
        await uploadPhotoFile(endpoint, item.file, signal);
        setItems((current) => current.map((entry, index) => index === item.index ? { ...entry, status: "uploaded", retryable: false } : entry));
        uploaded++;
      } catch (uploadError) {
        if (signal.aborted) break;
        setItems((current) => current.map((entry, index) => index === item.index ? { ...entry, status: "error", retryable: true, message: uploadError instanceof Error ? uploadError.message : "Ошибка загрузки. Попробуйте ещё раз." } : entry));
      }
      setBatch({ completed: position + 1, total: targets.length });
    }

    if (!signal.aborted) {
      setPending(false);
      uploading.current = false;
      if (uploaded) { onUploaded(); router.refresh(); }
    }
  }

  const statusLabels = { checking: "Проверяем фото…", "needs-reduction": "Нужно уменьшить", preparing: "Создаём уменьшенную копию…", ready: "Готово к загрузке", uploading: "Загружается…", uploaded: "Добавлено в альбом", error: "Не загружено" };

  return (
    <>
    {guest && !compactGuest && <div className="guest-photo-cta"><div><strong>Ваши фотки — в общем альбоме</strong><p>Сделайте фото сейчас или выберите готовые снимки. Они появятся в альбоме сразу.</p></div><div className="photo-source-actions"><button ref={cameraTrigger} className="button button-primary" type="button" onClick={openCamera} disabled={busy}><UiIcon name="camera" />Сделать фото</button><button className="button button-outline" type="button" onClick={() => fileInput.current?.click()} disabled={pending}>Добавить фотки <span aria-hidden="true">↑</span></button></div></div>}
    {cameraMessage && <p className="form-success" role="status">{cameraMessage}</p>}
    <form ref={uploadForm} noValidate className="photo-upload" hidden={compactGuest && items.length === 0 && !error} onSubmit={upload} aria-busy={busy}>
      <div className="photo-upload-heading"><div><h3>{guest ? "Поделитесь своими снимками" : "Добавьте фотографии"}</h3><p>JPEG, PNG или WebP. До {maxUploadMb.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} МБ и {maxPixels / 1_000_000} Мп на фотографию, до 20 файлов за раз.</p></div>{!guest && <button ref={cameraTrigger} className="button button-outline photo-camera-trigger" type="button" onClick={openCamera} disabled={busy}><UiIcon name="camera" />Сделать фото</button>}</div>
      <div className="form-field"><label htmlFor={inputId}>Выберите фотографии</label><input ref={fileInput} id={inputId} name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={pending} onChange={(event) => void selectFiles(event.target.files)} aria-describedby={`${inputId}-help${error ? ` ${inputId}-error` : ""}`} aria-invalid={Boolean(error)} /><p className="field-help" id={`${inputId}-help`}>Большие фото можно уменьшить здесь перед загрузкой. В альбом попадёт уменьшенная копия; исходный файл останется на устройстве. Фотографии загружаются по очереди.</p></div>
      {items.length > 0 && <ul className="upload-file-list">{items.map((item, index) => <li key={`${item.file.name}-${index}`} className={`upload-file upload-file-${item.status}`}><div><strong>{item.file.name}</strong><small>{(item.file.size / (1024 * 1024)).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} МБ</small>{item.copyNotice && <small className={styles.notice}>{item.copyNotice}</small>}</div><div className={styles.status}><span role={item.status === "preparing" ? "status" : undefined}>{item.message || statusLabels[item.status]}</span>{item.status === "needs-reduction" && <button type="button" className="button button-outline" disabled={busy} onClick={() => void prepareFiles(index)} aria-label={`Уменьшить ${item.file.name}`}>Уменьшить фото</button>}</div></li>)}</ul>}
      {reducible.length > 1 && <button className={`button button-outline ${styles.action}`} type="button" disabled={busy} onClick={() => void prepareFiles()}>Уменьшить все большие фото ({reducible.length})</button>}
      {items.length > 0 && <button className={`button button-outline ${styles.action}`} type="button" disabled={pending} onClick={clearSelection}>{processing ? "Отменить и очистить выбор" : "Очистить выбор"}</button>}
      {batch.total > 0 && <div className="upload-progress"><progress value={batch.completed} max={batch.total} aria-label="Прогресс загрузки" /><p role="status" aria-live="polite">{pending ? `Загрузка: ${batch.completed} из ${batch.total}.` : `Обработано ${batch.completed} из ${batch.total} фотографий.`}{!pending && items.some((item) => item.status === "uploaded") ? " Загруженные фотографии уже видны в альбоме." : ""}</p></div>}
      <button className="button button-primary" type="submit" disabled={busy || (items.length > 0 && uploadable.length === 0)}>{processing ? "Подготавливаем фотографии…" : pending ? "Загружаем фотографии…" : (items.some((item) => item.status === "error" && item.retryable) ? "Повторить загрузку" : "Загрузить фотографии")}<span aria-hidden="true">↑</span></button>
      {error && <p className="form-error" id={`${inputId}-error`} role="alert">{error}</p>}
    </form>
    {compactGuest && <nav className="site-navigation guest-navigation" aria-label="Навигация мероприятия">
      <div className="site-navigation-inner">
        <a href="#guest-gallery" className={`site-navigation-link${cameraOpen ? "" : " is-active"}`} aria-current={cameraOpen ? undefined : "location"}><UiIcon name="album" /><span>Галерея</span></a>
        <button ref={cameraTrigger} type="button" className={`site-navigation-link${cameraOpen ? " is-active" : ""}`} aria-label="Сделать фото" onClick={openCamera} disabled={busy}><UiIcon name="camera" /><span>Камера</span></button>
        <button type="button" className="site-navigation-link" aria-label="Добавить фотки" onClick={() => fileInput.current?.click()} disabled={pending}><UiIcon name="plus" /><span>Добавить</span></button>
      </div>
    </nav>}
    {cameraOpen && <PhotoCamera maxUploadMb={maxUploadMb} maxPixels={maxPixels} onUpload={uploadCapture} onClose={closeCamera} onChooseFile={() => { setCameraOpen(false); fileInput.current?.click(); }} />}
    </>
  );
}
