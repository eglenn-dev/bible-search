// Shared hover tooltip for the stats charts: one fixed element for the whole
// page, driven imperatively (not React state) so mousemove never re-renders
// chart trees. Lives outside charts.tsx so that file only exports components
// (react-refresh/only-export-components).

import { useEffect } from "react";

let tipEl: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className =
            "pointer-events-none fixed z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-[13px] leading-snug text-background opacity-0 transition-opacity duration-75";
        document.body.appendChild(tipEl);
    }
    return tipEl;
}

export function showTip(ev: { clientX: number; clientY: number }, html: string) {
    const el = ensureTip();
    el.innerHTML = html;
    el.style.opacity = "1";
    const pad = 14;
    const w = el.offsetWidth;
    let x = ev.clientX + pad;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
    el.style.left = `${x}px`;
    el.style.top = `${ev.clientY + pad}px`;
}

export function hideTip() {
    if (tipEl) tipEl.style.opacity = "0";
}

/** Hide the shared tooltip if the stats page unmounts mid-hover. */
export function useTipCleanup() {
    useEffect(
        () => () => {
            hideTip();
        },
        [],
    );
}
