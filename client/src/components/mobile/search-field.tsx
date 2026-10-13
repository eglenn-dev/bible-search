import { useRef } from "react";
import { ArrowUp, Search as SearchIcon, X } from "lucide-react";

interface SearchFieldProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    placeholder: string;
    loading: boolean;
    /** Greys out the submit button (e.g. no valid reference yet). */
    disabled?: boolean;
}

/**
 * The mobile search field: one glass capsule holding the input, a clear
 * button and a round submit button. SearchBox and ScriptureBox render this
 * instead of their desktop form when they are inside the mobile shell.
 */
export default function SearchField({
    value,
    onChange,
    onSubmit,
    placeholder,
    loading,
    disabled = false,
}: SearchFieldProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    return (
        <form
            role="search"
            onSubmit={(event) => {
                // Drop the keyboard so the results aren't hidden behind it.
                inputRef.current?.blur();
                onSubmit(event);
            }}
            className="glass flex h-[52px] w-full items-center rounded-full pl-4 pr-1.5 transition-shadow focus-within:ring-2 focus-within:ring-primary/45"
        >
            <SearchIcon
                className="h-5 w-5 flex-none text-muted-foreground"
                aria-hidden="true"
            />
            {/* 17px: iOS zooms the page when a focused input is under 16px. */}
            <input
                ref={inputRef}
                type="text"
                name="search-query"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label="Search"
                className="h-full min-w-0 flex-1 border-none bg-transparent px-2.5 text-[17px] text-foreground outline-none"
            />
            {value && (
                <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                        onChange("");
                        inputRef.current?.focus();
                    }}
                    className="mr-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-muted-foreground active:scale-90"
                >
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground/15">
                        <X className="h-3 w-3" strokeWidth={3} />
                    </span>
                </button>
            )}
            <button
                type="submit"
                aria-label={loading ? "Searching" : "Search"}
                disabled={loading || disabled}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90 disabled:opacity-50"
            >
                {loading ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                ) : (
                    <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                )}
            </button>
        </form>
    );
}
