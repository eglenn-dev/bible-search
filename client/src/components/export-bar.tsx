import { useEffect, useState } from "react";
import { Check, Copy, Download, Link2 } from "lucide-react";
import type { Result } from "@/lib/types";
import {
    downloadMarkdown,
    markdownFilename,
    passagesToMarkdown,
} from "@/lib/markdown-export";
import { useShareLink } from "@/lib/share";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ExportBarProps {
    results: Result[];
    /** Markdown document title. */
    title?: string;
    /** Offer "Copy share link" (not on a collection someone shared). */
    shareable?: boolean;
    className?: string;
}

type Status = { tone: "ok" | "error"; message: string } | null;

/**
 * Desktop export row: Copy as Markdown, Download .md, and (for your own
 * list) a share link. Feedback appears on the button and in a live region
 * under the row, so it's announced as well as seen.
 */
export default function ExportBar({
    results,
    title,
    shareable = false,
    className,
}: ExportBarProps) {
    const [copied, setCopied] = useState<"markdown" | "link" | null>(null);
    const [status, setStatus] = useState<Status>(null);
    const share = useShareLink(results, shareable);

    useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => setCopied(null), 1800);
        return () => clearTimeout(timer);
    }, [copied]);

    // A stale "Link copied" shouldn't describe a list that has since changed.
    useEffect(() => setStatus(null), [results]);

    const copyMarkdown = async () => {
        try {
            await navigator.clipboard.writeText(
                passagesToMarkdown(results, { title }),
            );
            setCopied("markdown");
            setStatus({ tone: "ok", message: "Markdown copied to clipboard." });
        } catch {
            setStatus({
                tone: "error",
                message: "Couldn't reach the clipboard. Try Download .md.",
            });
        }
    };

    const download = () => {
        downloadMarkdown(passagesToMarkdown(results, { title }), markdownFilename());
        setStatus(null);
    };

    const copyLink = async () => {
        if (share.status === "error") {
            setStatus({ tone: "error", message: share.error.message });
            return;
        }
        if (share.status !== "ready") return;
        try {
            await navigator.clipboard.writeText(share.url);
            setCopied("link");
            setStatus({
                tone: "ok",
                message: `Link copied. Anyone who opens it can read ${
                    results.length === 1
                        ? "this passage"
                        : `these ${results.length} passages`
                } and save them; nothing is uploaded.`,
            });
        } catch {
            setStatus({
                tone: "error",
                message: "Couldn't reach the clipboard.",
            });
        }
    };

    const disabled = results.length === 0;

    return (
        <div className={className}>
            <div className="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={copyMarkdown}
                    disabled={disabled}
                >
                    {copied === "markdown" ? (
                        <Check className="text-primary" />
                    ) : (
                        <Copy />
                    )}
                    Copy as Markdown
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={download}
                    disabled={disabled}
                >
                    <Download />
                    Download .md
                </Button>
                {shareable && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={copyLink}
                        // Pending only for the moment it takes to compress.
                        disabled={disabled || share.status === "pending"}
                    >
                        {copied === "link" ? (
                            <Check className="text-primary" />
                        ) : (
                            <Link2 />
                        )}
                        Copy share link
                    </Button>
                )}
            </div>
            <p
                aria-live="polite"
                className={cn(
                    "text-[13px] leading-snug empty:hidden",
                    status && "mt-2",
                    status?.tone === "error"
                        ? "text-destructive"
                        : "text-muted-foreground",
                )}
            >
                {status?.message}
            </p>
        </div>
    );
}
