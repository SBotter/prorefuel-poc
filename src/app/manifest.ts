import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LENS by ProRefuel",
    short_name: "LENS",
    description:
      "Cinematic GPS video editor for cyclists, MTB & trail runners",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/LENS_name_circle_white.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/LENS_name_circle_white.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
