import { createFileRoute } from "@tanstack/react-router";
import App from "@/App";

export const Route = createFileRoute("/")({
    // Rendered in the browser only: which layout to show (the mobile shell or
    // the desktop page) depends on the viewport, and bookmarks/theme live in
    // localStorage, so a server render would flash the wrong UI on phones.
    ssr: false,
    component: App,
});
