import { existsSync } from "fs";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { generateSW, type GenerateSWOptions } from "workbox-build";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Writes the service worker (sw.js) into the client output once the whole
 * app is built: Nitro has written the static files (.output/public, or
 * .vercel/output/static on Vercel) and TanStack Start has prerendered the
 * SPA shell into them, so both are in the precache manifest. Listed after
 * tanstackStart() so this runs after its own post-build step.
 *
 * vite-plugin-pwa can't do this here: it generates per Vite environment
 * (client, ssr, nitro), before the shell exists, into the wrong directory.
 */
function serviceWorker(
    options: Omit<GenerateSWOptions, "globDirectory" | "swDest">,
): Plugin {
    return {
        name: "gospel-help:service-worker",
        apply: "build",
        enforce: "post",
        buildApp: {
            order: "post",
            async handler(builder) {
                const { root, build } = builder.environments.client.config;
                const outDir = path.resolve(root, build.outDir);
                // TanStack Start logs a failed prerender but still exits 0;
                // a worker whose navigation fallback is missing would fail
                // to install, silently leaving the app without offline.
                const fallback = options.navigateFallback;
                if (fallback && !existsSync(path.join(outDir, fallback))) {
                    throw new Error(
                        `[sw] ${fallback} is missing from ${outDir}; did the SPA shell prerender fail?`,
                    );
                }
                const { count, size, warnings } = await generateSW({
                    ...options,
                    globDirectory: outDir,
                    swDest: path.join(outDir, "sw.js"),
                    sourcemap: false,
                });
                for (const warning of warnings) console.warn(`[sw] ${warning}`);
                console.log(
                    `[sw] precached ${count} files (${(size / 1024).toFixed(1)} KiB)`,
                );
            },
        },
    };
}

// https://tanstack.com/start/latest/docs/framework/react/guide/hosting
// Nitro builds the server for whichever host it detects: a Vercel Function
// (Build Output API) on Vercel, a plain Node server (`npm start`) elsewhere.
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
            tanstackStart({
                // Also prerender an app shell (/_shell.html) that boots the
                // client router at any URL. It's the service worker's
                // navigation fallback, so once the worker is installed it
                // serves every navigation (as index.html did before);
                // first visits and browsers without it get the server.
                spa: { enabled: true },
            }),
            nitro(),
            react(),
            tailwindcss(),
            // A waiting update is announced by UpdateToast, never swapped in
            // under someone mid-search (skipWaiting stays off; the worker
            // waits for UpdateToast's "Reload").
            serviceWorker({
                globPatterns: [
                    "**/*.{js,css,html,svg,png,ico,webmanifest}",
                ],
                // The SPA shell (see tanstackStart above): opens the app at any
                // URL, with or without a network, then the router renders
                // the route.
                navigateFallback: "/_shell.html",
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
            }),
        ],
        resolve: {
            alias: {
                "@": path.resolve(import.meta.dirname, "./src"),
            },
        },
    };
});
