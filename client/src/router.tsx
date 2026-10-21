import {
    createRouter,
    parseSearchWith,
    stringifySearchWith,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
    return createRouter({
        routeTree,
        // Search params stay plain strings: nuqs owns parsing and validation
        // (see App.tsx), and TanStack's default JSON-style parsing would
        // rewrite free text — `?q=1e5` would come back as `?q=100000`.
        parseSearch: parseSearchWith((value) => value),
        stringifySearch: stringifySearchWith(JSON.stringify),
    });
}

declare module "@tanstack/react-router" {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
