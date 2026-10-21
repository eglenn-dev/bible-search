import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import StatsPage from "@/pages/stats";

export const Route = createFileRoute("/stats")({
    // The figures come from GET /stats in the browser, and the header's theme
    // toggle reads localStorage, so there's nothing useful to render on the
    // server yet. wrapInSuspense and ClientOnly: see routes/index.tsx.
    ssr: false,
    wrapInSuspense: true,
    component: () => (
        <ClientOnly>
            <StatsPage />
        </ClientOnly>
    ),
});
