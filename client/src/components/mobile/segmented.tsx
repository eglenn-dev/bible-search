import { cn } from "@/lib/utils";

interface SegmentedProps<T extends string | number> {
    value: T;
    onChange: (next: T) => void;
    options: readonly { value: T; label: string; Icon?: React.ElementType }[];
    /** Names the group for assistive tech. */
    label: string;
    /** On a sheet the control is an inset track; elsewhere it is glass. */
    inset?: boolean;
    className?: string;
}

/** iOS-style segmented control: a thumb slides under the selected segment. */
export default function Segmented<T extends string | number>({
    value,
    onChange,
    options,
    label,
    inset = false,
    className,
}: SegmentedProps<T>) {
    const index = Math.max(
        0,
        options.findIndex((o) => o.value === value),
    );
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cn(
                "relative grid h-11 rounded-full p-1",
                inset ? "bg-foreground/[0.07]" : "glass",
                className,
            )}
            style={{
                gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
            }}
        >
            <span
                aria-hidden="true"
                className={cn(
                    "pointer-events-none absolute inset-y-1 left-1 rounded-full transition-transform duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)]",
                    inset
                        ? "bg-card shadow-[0_1px_4px_rgba(0,0,0,0.16)]"
                        : "bg-[var(--glass-thumb)]",
                )}
                style={{
                    width: `calc((100% - 0.5rem) / ${options.length})`,
                    transform: `translateX(${index * 100}%)`,
                }}
            />
            {options.map(({ value: v, label: text, Icon }) => {
                const active = v === value;
                return (
                    <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(v)}
                        className={cn(
                            "relative z-10 flex min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[15px] transition-colors",
                            active
                                ? cn(
                                      "font-semibold",
                                      inset
                                          ? "text-foreground"
                                          : "text-primary",
                                  )
                                : "text-muted-foreground",
                        )}
                    >
                        {Icon && <Icon className="h-4 w-4 flex-none" />}
                        <span className="truncate">{text}</span>
                    </button>
                );
            })}
        </div>
    );
}
