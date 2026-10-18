import type { Metadata } from "next";
import { DemoAlbum } from "@/components/demo-album";

export const metadata: Metadata = {
  title: "Пример альбома — PartyPhoto",
  description: "Попробуйте PartyPhoto без регистрации: откройте фотографии, поставьте лайк и включите слайд-шоу.",
};

export default function DemoPage() {
  return <DemoAlbum />;
}
