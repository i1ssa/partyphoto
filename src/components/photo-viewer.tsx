"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./photo-viewer.module.css";

export type ViewerPhoto = {
  id: string;
  filename: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  alt?: string;
};

type PhotoViewerProps<T extends ViewerPhoto> = {
  photos: T[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  renderActions?: (photo: T) => ReactNode;
  totalCount?: number;
  hasMore?: boolean;
  /** Append the next page to photos and return its first new photo ID. */
  onLoadMore?: () => Promise<string | null>;
  loadingMore?: boolean;
  loadError?: string;
};

export function PhotoViewer<T extends ViewerPhoto>({
  photos, activeId, onSelect, onClose, renderActions,
  totalCount, hasMore = false, onLoadMore, loadingMore = false, loadError,
}: PhotoViewerProps<T>) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const requesting = useRef(false);
  const playbackRun = useRef(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [requestingPage, setRequestingPage] = useState(false);
  const [navigationError, setNavigationError] = useState("");
  const [readyId, setReadyId] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const index = photos.findIndex(photo => photo.id === activeId);
  const photo = photos[index];
  const canPrevious = index > 0;
  const canNext = index >= 0 && (index < photos.length - 1 || Boolean(hasMore && onLoadMore));
  const busy = loadingMore || requestingPage;

  const stopPlayback = useCallback(() => {
    playbackRun.current++;
    setPlaying(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const element = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    closeButton.current?.focus();
    const stop = stopPlayback;
    const onVisibilityChange = () => { if (document.hidden) stop(); };
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = () => { if (reducedMotion.matches) stop(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", stop);
    reducedMotion.addEventListener("change", onMotionChange);
    return () => {
      mounted.current = false;
      element?.close();
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", stop);
      reducedMotion.removeEventListener("change", onMotionChange);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [stopPlayback]);

  const close = () => {
    stopPlayback();
    onClose();
  };

  const next = useCallback(async (automaticRun?: number) => {
    if (loadingMore || requesting.current) return;
    setNavigationError("");
    const following = photos[index + 1];
    if (following) {
      onSelect(following.id);
      return;
    }
    if (!hasMore || !onLoadMore) {
      stopPlayback();
      return;
    }
    requesting.current = true;
    setRequestingPage(true);
    try {
      const nextId = await onLoadMore();
      if (!mounted.current) return;
      // A paused/hidden slideshow may finish fetching a page, but must not
      // change the displayed photo after the pause.
      if (automaticRun !== undefined && (document.hidden || automaticRun !== playbackRun.current)) return;
      if (nextId) onSelect(nextId);
      else {
        stopPlayback();
        setNavigationError("Не удалось перейти дальше. Попробуйте ещё раз или обновите галерею.");
      }
    } catch {
      if (mounted.current) {
        stopPlayback();
        setNavigationError("Не удалось загрузить следующие фотографии. Попробуйте ещё раз.");
      }
    } finally {
      requesting.current = false;
      if (mounted.current) setRequestingPage(false);
    }
  }, [hasMore, index, loadingMore, onLoadMore, onSelect, photos, stopPlayback]);

  const navigate = useCallback((direction: -1 | 1) => {
    if (busy || requesting.current) return;
    stopPlayback();
    setNavigationError("");
    if (direction === 1) void next();
    else if (canPrevious) onSelect(photos[index - 1].id);
  }, [busy, canPrevious, index, next, onSelect, photos, stopPlayback]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = dialog.current;
      if (!element?.open) return;
      if (event.key === "Tab") {
        const controls = Array.from(element.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"))
          .filter(control => control.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!element.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (!canNext && playing) stopPlayback();
    if (!playing || !canNext || busy || (readyId !== activeId && !failedImages.has(activeId))) return;
    const run = playbackRun.current;
    const timer = window.setTimeout(() => { if (!document.hidden) void next(run); }, 4000);
    return () => window.clearTimeout(timer);
  }, [activeId, busy, canNext, failedImages, next, playing, readyId, stopPlayback]);

  if (!photo) return null;
  const counter = `${index + 1} из ${Math.max(totalCount ?? photos.length, photos.length)}${hasMore && totalCount === undefined ? "+" : ""}`;

  return (
    <dialog ref={dialog} className={`photo-preview-dialog ${styles.dialog}`} aria-labelledby={titleId} aria-describedby={`${titleId}-help`}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.content}>
        <div className="photo-preview-header">
          <h3 id={titleId}>{photo.filename}</h3>
          <button ref={closeButton} className="dialog-close" type="button" onClick={close} aria-label="Закрыть просмотр фотографии">×</button>
        </div>
        <p id={`${titleId}-help`} className="sr-only">Листайте стрелками влево и вправо или свайпом по фотографии. Escape закрывает просмотр. Слайд-шоу меняет фотографию каждые четыре секунды и останавливается в конце альбома.</p>
        <div className={styles.stage} data-photo-viewer-stage aria-busy={busy}
          onTouchStart={event => {
            const touch = event.touches.length === 1 ? event.touches[0] : null;
            touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchCancel={() => { touchStart.current = null; }}
          onTouchEnd={event => {
            const start = touchStart.current;
            touchStart.current = null;
            const touch = event.changedTouches[0];
            if (!start || !touch || event.touches.length) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) navigate(dx < 0 ? 1 : -1);
          }}>
          {failedImages.has(photo.id) ? <p className={styles.imageError}>Превью недоступно. Можно перейти к следующей фотографии.</p> :
            <img key={photo.id} src={photo.thumbnailUrl} width={photo.width} height={photo.height} alt={photo.alt ?? photo.filename} draggable={false}
              onLoad={() => setReadyId(photo.id)}
              onError={() => { setReadyId(photo.id); setFailedImages(current => new Set(current).add(photo.id)); }} />}
        </div>
        <div className={styles.navigation} role="group" aria-label="Просмотр фотографий">
          <button className={styles.arrow} type="button" onClick={() => navigate(-1)} disabled={!canPrevious || busy} aria-label="Предыдущая фотография"><span aria-hidden="true">←</span></button>
          <span className={styles.counter} aria-live="polite" aria-atomic="true">{counter}</span>
          <button className={styles.arrow} type="button" onClick={() => navigate(1)} disabled={!canNext || busy} aria-label="Следующая фотография"><span aria-hidden="true">→</span></button>
          <button className={`button button-outline ${styles.play}`} type="button" aria-pressed={playing}
            disabled={!playing && !canNext} onClick={() => { if (playing) stopPlayback(); else { playbackRun.current++; setPlaying(true); } }}>
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span> {playing ? "Пауза" : "Слайд-шоу"}
          </button>
        </div>
        <p className={styles.status} role="status">{busy ? "Загружаем следующие фотографии…" : playing ? "Смена кадра каждые 4 секунды" : !canNext ? "Последняя фотография" : "Листайте стрелками или свайпом"}</p>
        {(loadError || navigationError) && <p className="form-error" role="alert">{loadError || navigationError}</p>}
        {renderActions && <div className={`photo-preview-footer ${styles.footer}`}><span>Превью фотографии</span><div className="photo-preview-controls">{renderActions(photo)}</div></div>}
      </div>
    </dialog>
  );
}
