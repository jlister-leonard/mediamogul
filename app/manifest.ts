import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nightstand",
    short_name: "Nightstand",
    description: "Everything you read, watch, and hear — in one place.",
    id: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#171310",
    theme_color: "#171310",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Receiving end is a stub until E8.1 lands the real capture flow.
    share_target: {
      action: "/inbox",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
