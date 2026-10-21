/// <reference types="vite/client" />
import {
    createRootRoute,
    HeadContent,
    Outlet,
    ScriptOnce,
    Scripts,
} from "@tanstack/react-router";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import ThemeProvider from "@/components/theme-provider";
import appCss from "@/index.css?url";

const TITLE = "Gospel Help — Gospel Library Search";
const GA_ID = "G-6E2J3P6RJS";

// Paint the saved theme before first paint so a dark-mode load never flashes
// the light palette. Mirrors src/lib/theme.ts; keep the storage key
// ("gs-theme"), the default ("system") and the theme-color values in sync
// with it.
//
// It also creates the theme-color <meta> (browser chrome / status bar
// colour), which src/lib/theme.ts then keeps matched to the painted theme.
// React doesn't render that tag: it matches hoisted <meta>s by their
// attributes, so one whose content changed before hydration would be
// duplicated rather than reused.
const THEME_SCRIPT = `(function () {
  var dark = false;
  try {
    var saved = localStorage.getItem("gs-theme");
    var theme = saved === "light" || saved === "dark" ? saved : "system";
    dark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    /* storage unavailable — the ThemeProvider re-applies on mount */
  }
  var meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = dark ? "#17181a" : "#ffffff";
  document.head.appendChild(meta);
})();`;

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: "UTF-8" },
            // viewport-fit=cover lets the mobile shell draw under the notch
            // and home indicator; it pads itself back in with
            // env(safe-area-inset-*).
            {
                name: "viewport",
                content:
                    "width=device-width, initial-scale=1.0, viewport-fit=cover",
            },
            { title: TITLE },
            {
                name: "description",
                content:
                    "gospel.help — semantic search across the Scriptures, General Conference addresses, BYU Speeches, and the General Handbook.",
            },
            { name: "apple-mobile-web-app-title", content: "Gospel Help" },
            // Opened from the Home Screen, run full-screen like an app.
            { name: "mobile-web-app-capable", content: "yes" },
            { name: "apple-mobile-web-app-capable", content: "yes" },
            {
                name: "apple-mobile-web-app-status-bar-style",
                content: "default",
            },
            { property: "og:title", content: TITLE },
            {
                property: "og:description",
                content:
                    "Semantic search across the Scriptures, General Conference addresses, BYU Speeches, and the General Handbook.",
            },
            { property: "og:url", content: "https://gospel.help/" },
            { property: "og:type", content: "website" },
            { name: "twitter:card", content: "summary" },
        ],
        links: [
            { rel: "icon", href: "/favicon.ico" },
            { rel: "alternate icon", type: "image/svg+xml", href: "/favicon.svg" },
            // iOS ignores SVG/ICO favicons for "Add to Home Screen"; it needs
            // an opaque 180×180 PNG.
            {
                rel: "apple-touch-icon",
                sizes: "180x180",
                href: "/apple-touch-icon.png",
            },
            { rel: "manifest", href: "/manifest.webmanifest" },
            { rel: "canonical", href: "https://gospel.help/" },
            { rel: "preconnect", href: "https://fonts.googleapis.com" },
            {
                rel: "preconnect",
                href: "https://fonts.gstatic.com",
                crossOrigin: "anonymous",
            },
            // Open-licence stand-ins for the Church's Ensign:Sans / Ensign:Serif.
            {
                rel: "stylesheet",
                href: "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap",
            },
            { rel: "stylesheet", href: appCss },
        ],
    }),
    // Rendered by <Scripts /> at the end of <body>.
    scripts: () => [
        {
            async: true,
            src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`,
        },
        {
            children: `window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', '${GA_ID}');`,
        },
    ],
    shellComponent: RootDocument,
    component: RootComponent,
});

function RootDocument({ children }: { children: React.ReactNode }) {
    return (
        // The theme script below sets the `dark` class before React hydrates,
        // so the class legitimately differs from the server render.
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
                <ScriptOnce>{THEME_SCRIPT}</ScriptOnce>
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}

function RootComponent() {
    return (
        <ThemeProvider>
            <NuqsAdapter>
                <Outlet />
            </NuqsAdapter>
        </ThemeProvider>
    );
}
