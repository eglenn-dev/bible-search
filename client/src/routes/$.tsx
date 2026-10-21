import { createFileRoute, redirect } from "@tanstack/react-router";

// The old SPA served the search page at any path; send stray links there,
// keeping their query and hash (a shared collection lives in `#saved=…`).
export const Route = createFileRoute("/$")({
    beforeLoad: ({ location }) => {
        throw redirect({
            to: "/",
            search: location.search,
            hash: location.hash,
        });
    },
});
