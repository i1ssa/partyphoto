"use client";

import Link from "next/link";
import { useState } from "react";
import { PhotoViewer, type ViewerPhoto } from "@/components/photo-viewer";
import { ThemeToggle } from "@/components/theme-toggle";
import { UiIcon } from "@/components/ui-icon";
import styles from "./demo-album.module.css";

const photos: ViewerPhoto[] = [
  { width: 1440, height: 960, alt: "Друзья вместе отмечают день рождения" },
  { width: 960, height: 1440, alt: "Праздничный торт под аркой из коралловых воздушных шаров" },
  { width: 960, height: 1440, alt: "Друзья с праздничным тортом в ярко украшенной комнате" },
  { width: 1440, height: 810, alt: "Друзья с тортом на праздничном пикнике" },
  { width: 960, height: 1440, alt: "Подарки в красивой упаковке на празднике" },
  { width: 1250, height: 1440, alt: "Праздничный стол со сладостями и воздушными шарами" },
].map((photo, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    ...photo,
    id: `demo-${number}`,
    filename: `Момент ${number}`,
    thumbnailUrl: `/demo-photos/${number}.jpg`,
  };
});

export function DemoAlbum() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());

  function toggleLike(id: string) {
    setLiked(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function likeButton(photo: ViewerPhoto) {
    const isLiked = liked.has(photo.id);
    return <button type="button" className={styles.like} aria-pressed={isLiked}
      aria-label={`${isLiked ? "Убрать лайк" : "Поставить лайк"} ${photo.filename}`}
      aria-describedby="demo-interactions-note" onClick={() => toggleLike(photo.id)}>
      <span aria-hidden="true">{isLiked ? "♥" : "♡"}</span>
      <span>{isLiked ? 1 : 0}<span className="sr-only"> {isLiked ? "лайк" : "лайков"} в примере</span></span>
    </button>;
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link className="brand" href="/">partyphoto<span>●</span></Link>
      <nav className={styles.navigation} aria-label="Навигация примера">
        <Link className="header-link" href="/">На главную</Link>
        <ThemeToggle />
      </nav>
    </header>

    <section className={styles.intro} aria-labelledby="demo-title">
      <p className={styles.badge}><UiIcon name="album" />Пример альбома</p>
      <h1 id="demo-title">Моменты, которыми<br /><em>хочется делиться.</em></h1>
      <p className={styles.description}>Так может выглядеть альбом вашего события. Откройте любой кадр, полистайте фотографии или включите слайд-шоу.</p>
      <p className={styles.note}>Можно попробовать без регистрации.</p>
    </section>

    <section className={styles.gallery} aria-labelledby="demo-gallery-title">
      <div className={styles.galleryHeading}>
        <h2 id="demo-gallery-title">Галерея</h2>
        <span className="guest-photo-count">6 фото</span>
      </div>
      <div className={styles.grid}>
        {photos.map((photo, index) => <article className={styles.card} key={photo.id}>
          <button type="button" className={styles.preview} onClick={() => setActiveId(photo.id)}
            aria-label={`Открыть фотографию ${photo.filename}`}>
            <img src={photo.thumbnailUrl} alt={photo.alt ?? photo.filename}
              width={photo.width} height={photo.height}
              loading={index < 3 ? "eager" : "lazy"} decoding="async" />
          </button>
          <div className={styles.caption}>
            <span>{photo.filename}</span>
            {likeButton(photo)}
          </div>
        </article>)}
      </div>
      <p className={styles.interactionsNote} id="demo-interactions-note">Это демонстрационный альбом. Лайки в примере сбрасываются после обновления страницы.</p>
    </section>

    <section className={styles.create} aria-labelledby="demo-create-title">
      <div>
        <p className="eyebrow">ТЕПЕРЬ ВАША ИСТОРИЯ</p>
        <h2 id="demo-create-title">Соберите свои воспоминания</h2>
        <p>Создайте событие и пригласите гостей по ссылке или QR-коду.</p>
      </div>
      <Link className="button button-primary" href="/register"><UiIcon name="plus" />Создать своё событие</Link>
    </section>
    <p className={styles.credits}><a href="/demo-photos/credits.html">Авторы фотографий</a></p>

    {activeId && <PhotoViewer photos={photos} activeId={activeId} onSelect={setActiveId}
      onClose={() => setActiveId(null)} renderActions={likeButton} />}
  </main>;
}
