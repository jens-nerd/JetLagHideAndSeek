// @ts-check
import partytown from "@astrojs/partytown";
import react from "@astrojs/react";
import tailwind from "@astrojs/tailwind";
import AstroPWA from "@vite-pwa/astro";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    integrations: [
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        partytown({
            config: {
                forward: ["dataLayer.push"],
            },
        }),
        AstroPWA({
            manifest: {
                name: "Hide’n’Seek – auf der echten Karte",
                short_name: "Hide’n’Seek",
                description:
                    "Runde per Code, Fragen mit GPS-Antwort, Kartenhand und Flüche. Das Spielgebiet legt ihr selbst fest.",
                icons: [
                    {
                        src: "/JLIcon.png",
                        sizes: "1080x1080",
                        type: "image/png",
                    },
                    {
                        src: "/android-chrome-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "/android-chrome-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                theme_color: "#1F2F3F",
                lang: "de",
            },
            workbox: {
                // @vite-pwa/astro wuerde "en/index.html" auf "en" kuerzen,
                // ausgeliefert wird die Seite aber unter "/en/". Der Precache
                // greift dann nicht und der Navigations-Fallback schiebt der
                // englischen Route das deutsche Dokument unter. Diese
                // Transformation ersetzt die des Adapters und haengt den
                // Schraegstrich an. Setzt der Adapter das selbst um, kann sie
                // ersatzlos weg.
                manifestTransforms: [
                    (entries) => {
                        entries
                            .filter((entry) => entry.url.endsWith("index.html"))
                            .forEach((entry) => {
                                entry.url = `/${entry.url.slice(0, -"index.html".length)}`;
                            });
                        return { manifest: entries, warnings: [] };
                    },
                ],
            },
        }),
    ],
    devToolbar: {
        enabled: false,
    },
    site: "https://hideandseek.vielhaben.com",
    base: "/",
});
