import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Events",
    short_name: "Family Events",
    start_url: "/",
    display: "standalone",
    background_color: "#fffdfb",
    theme_color: "#63409f",
    lang: "ru",
  };
}
