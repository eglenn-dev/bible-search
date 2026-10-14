import { useEffect, useRef, useState } from "react";
import type {
    ContextPassage,
    PassageContext as Context,
    Result,
} from "@/lib/types";
import { fetchPassageContext } from "@/lib/passages";
import { isScripture } from "@/lib/result-display";
import { cn } from "@/lib/utils";

interface PassageContextProps {
    /** The result being expanded; it must have an `id`. */
    result: Result & { id: string };
    /** Type size/leading of the surrounding text (desktop list vs. sheet). */
    textClassName: string;
    /** Bring the matched passage into view once its neighbours arrive. */
    scrollToTarget?: boolean;
}

/**
 * A result read in place: the neighbouring verses (or paragraphs of the talk)
 * around it, fetched on first expand, with the matched passage marked by a
 * rule in the margin. Until the neighbours arrive it shows just the passage,
 * so expanding never blanks the card.
 */
export default function PassageContext({
    result,
    textClassName,
    scrollToTarget = false,
}: PassageContextProps) {
    const [context, setContext] = useState<Context | null>(null);
    const [failed, setFailed] = useState(false);
    const targetRef = useRef<HTMLDivElement>(null);
    const scripture = isScripture(result);

    useEffect(() => {
        let cancelled = false;
        fetchPassageContext(result.id).then(
            (data) => {
                if (!cancelled) setContext(data);
            },
            (error) => {
                console.error("Error fetching context:", error);
                if (!cancelled) setFailed(true);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [result.id]);

    useEffect(() => {
        if (context && scrollToTarget) {
            targetRef.current?.scrollIntoView({
                block: "center",
                behavior: "smooth",
            });
        }
    }, [context, scrollToTarget]);

    const passages: Pick<
        ContextPassage,
        "id" | "text" | "metadata" | "is_target"
    >[] = context?.passages ?? [
        {
            id: result.id,
            text: result.text,
            metadata: result.metadata,
            is_target: true,
        },
    ];
    const ellipsis = (
        <div aria-hidden="true" className="pl-3 text-muted-foreground">
            ⋯
        </div>
    );

    return (
        <div className="flex flex-col gap-3">
            {context?.more_before && ellipsis}
            {passages.map((p) => (
                <div
                    key={p.id}
                    ref={p.is_target ? targetRef : undefined}
                    aria-current={p.is_target ? "true" : undefined}
                    className={cn(
                        "whitespace-pre-line border-l-2 pl-3 font-display transition-colors",
                        textClassName,
                        p.is_target
                            ? "border-primary text-foreground"
                            : "border-transparent text-foreground/60",
                    )}
                >
                    {scripture && p.metadata?.verse !== undefined && (
                        <span className="mr-1.5 align-super font-sans text-[11px] font-semibold tabular-nums text-muted-foreground">
                            {p.metadata.verse}
                        </span>
                    )}
                    {p.text}
                </div>
            ))}
            {context?.more_after && ellipsis}
            {!context && !failed && (
                <p className="pl-3 text-sm text-muted-foreground">
                    Loading the surrounding {scripture ? "verses" : "text"}…
                </p>
            )}
            {failed && (
                <p className="pl-3 text-sm text-destructive">
                    Couldn’t load the surrounding text.
                </p>
            )}
            {context?.note && (
                <p className="pl-3 text-sm text-muted-foreground">
                    {context.note}
                </p>
            )}
        </div>
    );
}
