import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    // The API lives on its own origin. Workbox serializes these route
    // patterns into the generated service worker, so they're RegExps built
    // from the origin now rather than functions closing over it.
    const env = loadEnv(mode, process.cwd(), "VITE_");
    let api = "";
    try {
        api = escapeRegExp(new URL(env.VITE_API_DOMAIN).origin);
    } catch {
        // No API domain set (the Landing screen reports that); cache nothing.
        api = "a^";
    }

    return {
        plugins: [
            react(),
            tailwindcss(),
            VitePWA({
                // A waiting update is announced by UpdateToast, never swapped
                // in under someone mid-search.
                registerType: "prompt",
                injectRegister: false,
                // public/manifest.webmanifest is the manifest; index.html
                // already links it.
                manifest: false,
                workbox: {
                    globPatterns: [
                        "**/*.{js,css,html,svg,png,ico,webmanifest}",
                    ],
                    navigateFallback: "/index.html",
                    cleanupOutdatedCaches: true,
                    // Take over the page on first install, so searches from
                    // the very first visit are cached for offline. (Updates
                    // still wait for "Reload": skipWaiting stays off.)
                    clientsClaim: true,
                    runtimeCaching: [
                        // Searches: always ask the API, and fall back to the
                        // last answer for the exact same request when offline.
                        // This is what lets recent searches open offline.
                        {
                            urlPattern: new RegExp(
                                `^${api}/search(/by-reference|/similar)?\\?`,
                            ),
                            handler: "NetworkFirst",
                            options: {
                                cacheName: "api-search",
                                expiration: {
                                    maxEntries: 80,
                                    maxAgeSeconds: 60 * 60 * 24 * 30,
                                },
                                cacheableResponse: { statuses: [200] },
                            },
                        },
                        // A passage's surroundings never change. Saving a
                        // passage pre-fetches its context, hence the room.
                        {
                            urlPattern: new RegExp(`^${api}/passage/context\\?`),
                            handler: "CacheFirst",
                            options: {
                                cacheName: "api-passages",
                                expiration: {
                                    maxEntries: 600,
                                    maxAgeSeconds: 60 * 60 * 24 * 180,
                                },
                                cacheableResponse: { statuses: [200] },
                            },
                        },
                        // Stats page and the speaker picker: precomputed and
                        // slow-moving, so show the cached copy straight away.
                        {
                            urlPattern: new RegExp(`^${api}/(stats|speakers)(\\?|$)`),
                            handler: "StaleWhileRevalidate",
                            options: {
                                cacheName: "api-reference",
                                expiration: { maxEntries: 30 },
                                cacheableResponse: { statuses: [200] },
                            },
                        },
                        {
                            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
                            handler: "StaleWhileRevalidate",
                            options: { cacheName: "google-fonts-stylesheets" },
                        },
                        {
                            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
                            handler: "CacheFirst",
                            options: {
                                cacheName: "google-fonts-webfonts",
                                expiration: {
                                    maxEntries: 30,
                                    maxAgeSeconds: 60 * 60 * 24 * 365,
                                },
                                cacheableResponse: { statuses: [0, 200] },
                            },
                        },
                    ],
                },
            }),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
    };
});
