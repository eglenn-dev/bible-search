// Saved passages as Markdown, for "Copy as Markdown" and "Download .md" in
// both layouts' Saved views and on a shared collection. Each passage is a
// heading, the text as a quote block, and an attribution line inside the
// quote, so a single passage pasted on its own still says where it's from.

import type { Result } from "./types";
import { SOURCE_LABELS, headingFor, metaLineFor } from "./result-display";
import { isAllowedSourceUrl } from "./share";

// Characters that would otherwise turn passage text into formatting.
function escapeInline(text: string): string {
    return text.replace(/([\\`*_[\]<>|])/g, "\\$1");
}

// Line starts that Markdown reads as a heading, list item or rule.
function escapeLine(line: string): string {
    return escapeInline(line).replace(/^(\s*)([#+-]|\d+[.)])(?=\s|$)/, "$1\\$2");
}

/** "> " in front of every line; blank lines keep the paragraphs apart. */
function quote(text: string): string {
    return text
        .trim()
        .split("\n")
        .map((line) => (line.trim() ? `> ${escapeLine(line.trim())}` : ">"))
        .join("\n");
}

/** "[churchofjesuschrist.org](…)" — only for the hosts we trust. */
function sourceLink(url: string): string {
    if (!isAllowedSourceUrl(url)) return "";
    const host = new URL(url).hostname.replace(/^www\./, "");
    // Parentheses and spaces would end the link target early.
    const target = url.replace(/[()\s]/g, (c) => encodeURIComponent(c));
    return `[${host}](${target})`;
}

/** One passage: heading, quoted text, attribution. */
export function passageToMarkdown(result: Result): string {
    const heading = headingFor(result);
    const attribution = [
        SOURCE_LABELS[result.source],
        // Conference/BYU references are usually the title again.
        result.reference !== heading ? result.reference : "",
        metaLineFor(result),
    ]
        .filter(Boolean)
        .map(escapeInline)
        .join(" · ");
    const link = sourceLink(result.url);
    return [
        `## ${escapeInline(heading)}`,
        "",
        quote(result.text),
        ">",
        `> — ${attribution}${link ? `  \n> ${link}` : ""}`,
    ].join("\n");
}

const exportDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
});

/** A whole collection, with a title and a one-line provenance note. */
export function passagesToMarkdown(
    results: Result[],
    { title = "Saved passages", date = new Date() } = {},
): string {
    const count = `${results.length} ${results.length === 1 ? "passage" : "passages"}`;
    return [
        `# ${escapeInline(title)}`,
        "",
        `_${count} · exported from Gospel Help on ${exportDate.format(date)}_`,
        ...results.flatMap((result) => ["", "---", "", passageToMarkdown(result)]),
        "",
    ].join("\n");
}

/** "gospel-help-saved-2026-10-14.md" */
export function markdownFilename(prefix = "gospel-help-saved"): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
}

/** Saves `markdown` through the browser's download flow. */
export function downloadMarkdown(markdown: string, filename: string): void {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the download a moment to start before the blob goes away.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}
