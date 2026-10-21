import { useEffect } from "react";
import {
    createFileRoute,
    redirect,
    useNavigate,
} from "@tanstack/react-router";

// The old SPA served the search page at any path; send stray links there,
// keeping their query and hash (a shared collection lives in `#saved=…`).
export const Route = createFileRoute("/$")({
    // From the server it's a real redirect. In the browser it's <StrayPath />
    // instead: there, a stray link is opened by the service worker's SPA
    // shell, and the router mishandles a redirect thrown while it hydrates
    // (it drops the match React is still rendering, and React logs a
    // recovered error before re-rendering the whole page).
    beforeLoad: ({ location }) => {
        if (typeof window === "undefined") {
            throw redirect({
                to: "/",
                search: location.search,
                hash: location.hash,
            });
        }
    },
    // The shell carries no state for this route, so match the Suspense
    // boundary the server renders around it (see routes/index.tsx).
    wrapInSuspense: true,
    component: StrayPath,
});

function StrayPath() {
    const navigate = useNavigate();
    useEffect(() => {
        void navigate({
            to: "/",
            search: (prev) => prev,
            hash: (prev) => prev ?? "",
            replace: true,
        });
    }, [navigate]);
    return null;
}
