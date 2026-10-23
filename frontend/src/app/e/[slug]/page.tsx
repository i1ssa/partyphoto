import { ThemeToggle } from "@/components/theme-toggle";
import { notFound } from "next/navigation";
import { getGuestAlbum } from "@backend/lib/albums";
import { AlbumAccess } from "@/components/album-access";
import { EventDate } from "@/components/event-date";
import { PhotoGallery } from "@/components/photo-gallery";
import { imagePixelLimit } from "@backend/lib/runtime-limits";

export const metadata = { title: "Альбом мероприятия — PartyPhoto", robots: { index: false, follow: false } };

export default async function AlbumPage({ params }: { params: Promise<{ slug: string }> }) {
  const album = await getGuestAlbum((await params).slug);
  if (!album) notFound();
  return <main className="guest-album-page">
    <header><span className="brand">partyphoto<span>●</span></span><nav className="header-nav" aria-label="Навигация"><ThemeToggle /></nav></header>
    <section className="guest-album-heading"><h1>{album.title}</h1>
      {album.locked ? <div className="auth-card" style={{maxWidth: 480}}><h2>Альбом защищён паролем</h2><p>Введите пароль от организатора.</p><AlbumAccess slug={album.slug}/></div> : <>
        {album.event?.description && <p className="intro" style={{whiteSpace: "pre-wrap"}}>{album.event.description}</p>}
        {album.event?.startsAt && <p>Дата мероприятия: <EventDate value={album.event.startsAt}/></p>}
      </>}
    </section>
    {!album.locked && album.event && <PhotoGallery slug={album.slug} maxUploadMb={album.event.maxUploadMb} maxPixels={imagePixelLimit()} allowUploads={album.event.allowGuestUploads} allowDownloads={album.event.allowDownloads} />}
  </main>;
}
