import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Events",
    short_name: "Family Events",
    id: "/",
    start_url: "/",
    scope: "/",
    description: "Семейные праздники и встречи",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#7e50c5",
    lang: "ru",
    prefer_related_applications: false,
  };
}
