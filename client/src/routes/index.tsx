import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import App from "@/App";

export const Route = createFileRoute("/")({
    // Rendered in the browser only: which layout to show (the mobile shell or
    // the desktop page) depends on the viewport, and bookmarks/theme live in
    // localStorage, so a server render would flash the wrong UI on phones.
    //
    // The service worker's SPA shell (prerendered at /) carries no state for
    // this route, so the browser doesn't know it's `ssr: false` while
    // hydrating the shell. wrapInSuspense matches the Suspense boundary the
    // server renders around an `ssr: false` route, and ClientOnly keeps
    // App's browser-only hooks out of hydration.
    ssr: false,
    wrapInSuspense: true,
    component: () => (
        <ClientOnly>
            <App />
        </ClientOnly>
    ),
});
