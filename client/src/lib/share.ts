// Sharing a set of saved passages as a link. There's no server-side storage,
// so the passages travel inside the link itself: a compact JSON list,
// deflate-compressed and base64url-encoded, in the URL *hash*
// (`/#saved=v1.<data>`). Browsers never send the hash to the server, so a
// shared collection stays between the two people and costs no request size.
//
// Whatever comes out of a link is untrusted: the decoder caps every size,
// rebuilds each passage field by field, checks it with `isBookmark`, and drops
// anything whose link isn't a churchofjesuschrist.org / speeches.byu.edu page.

import { useEffect, useState } from "react";
import { bookmarkId, isBookmark, type Bookmark } from "./bookmarks";
import { SOURCES, type Result, type ResultMetadata, type Source } from "./types";

/** Hash key: `#saved=…`. */
export const SHARE_HASH_KEY = "saved";

// Format tag ahead of the data, so a later encoding can coexist with links
// already sent around.
const VERSION_PREFIX = "v1.";

/**
 * Longest link we'll hand out. Browsers cope with far more, but chat apps
 * and mail clients start truncating or refusing long links, and a broken
 * link is worse than a clear "too many passages". Fits roughly 35 talk
 * paragraphs, or 55 mixed scripture-and-talk passages.
 */
export const MAX_SHARE_URL_LENGTH = 24_000;

// Decoder limits, deliberately looser than the encoder's so a link made by a
// slightly different build still opens, but tight enough that a hostile link
// can't make the page inflate megabytes or render thousands of items.
const MAX_ENCODED_LENGTH = 64_000;
const MAX_DECODED_BYTES = 512 * 1024;
const MAX_ENTRIES = 200;
const MAX_TEXT_LENGTH = 20_000;
const MAX_FIELD_LENGTH = 500;

// Metadata the display helpers (heading, meta line, date label) read. The
// rest of a result's metadata isn't worth the bytes in a link.
const METADATA_KEYS = [
    "speaker",
    "year",
    "month",
    "date",
    "volume",
    "translation",
    "chapter",
    "section_number",
    "section_title",
] as const;

/** One passage on the wire. Short keys: they repeat for every entry. */
export interface WireEntry {
    /** source */
    s: Source;
    /** reference */
    r: string;
    /** text */
    x: string;
    /** url */
    u: string;
    /** title, when it differs from the reference */
    t?: string;
    /** display metadata */
    m?: Partial<Record<(typeof METADATA_KEYS)[number], string | number>>;
    /** result id, when the API supplied one (keeps bookmark ids stable) */
    i?: string;
}

interface WirePayload {
    p: WireEntry[];
}

export type ShareErrorCode =
    | "unsupported" // no CompressionStream / DecompressionStream
    | "too-long" // encoding: link over MAX_SHARE_URL_LENGTH
    | "too-large" // decoding: over a size cap
    | "invalid" // decoding: not something we wrote
    | "empty"; // decoding: nothing usable inside

export class ShareError extends Error {
    readonly code: ShareErrorCode;
    constructor(code: ShareErrorCode, message: string) {
        super(message);
        this.name = "ShareError";
        this.code = code;
    }
}

const ALLOWED_HOSTS = ["churchofjesuschrist.org", "speeches.byu.edu"];

/**
 * True for http(s) links to the Church's site (any subdomain) or BYU
 * Speeches — the only places a passage should ever link to.
 */
export function isAllowedSourceUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return false;
    }
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
}

// ---- base64url -------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    // Chunked so a long payload doesn't overflow fromCharCode's arguments.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) {
        throw new ShareError("invalid", "The link has stray characters in it.");
    }
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    let binary: string;
    try {
        binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    } catch {
        throw new ShareError("invalid", "The link is incomplete.");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ---- compression -----------------------------------------------------------

function hasCompressionStreams(): boolean {
    return (
        typeof CompressionStream !== "undefined" &&
        typeof DecompressionStream !== "undefined"
    );
}

async function deflate(text: string): Promise<Uint8Array> {
    const stream = new Blob([text])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflates, giving up as soon as the output passes `limit` bytes. */
async function inflate(
    bytes: Uint8Array,
    limit: number,
    what: string,
): Promise<string> {
    const reader = new Blob([bytes as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) {
                await reader.cancel();
                throw new ShareError(
                    "too-large",
                    `This ${what} is too large to open.`,
                );
            }
            chunks.push(value);
        }
    } catch (e) {
        if (e instanceof ShareError) throw e;
        throw new ShareError("invalid", "The link is incomplete or damaged.");
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(out);
    } catch {
        throw new ShareError("invalid", "The link is incomplete or damaged.");
    }
}

// ---- encode ----------------------------------------------------------------

export function toWire(result: Result): WireEntry {
    const entry: WireEntry = {
        s: result.source,
        r: result.reference,
        x: result.text,
        u: result.url,
    };
    if (result.title && result.title !== result.reference) {
        entry.t = result.title;
    }
    const meta: WireEntry["m"] = {};
    for (const key of METADATA_KEYS) {
        const value = result.metadata?.[key];
        if (typeof value === "string" || typeof value === "number") {
            meta[key] = value;
        }
    }
    if (Object.keys(meta).length > 0) entry.m = meta;
    // Results may carry an id from the API; passing it along keeps an
    // imported bookmark's identity the same as the search result's.
    const id = (result as { id?: unknown }).id;
    if (typeof id === "string" && id) entry.i = id;
    return entry;
}

/** Any JSON payload as a `v1.…` token: deflated, then base64url. */
export async function packToken(payload: unknown): Promise<string> {
    if (!hasCompressionStreams()) {
        throw new ShareError(
            "unsupported",
            "This browser can't make share links.",
        );
    }
    return VERSION_PREFIX + toBase64Url(await deflate(JSON.stringify(payload)));
}

/** The `v1.…` token that goes after `#saved=`. */
export async function encodeCollection(results: Result[]): Promise<string> {
    const payload: WirePayload = { p: results.map(toWire) };
    return packToken(payload);
}

/**
 * Full share link for these passages, rooted at `origin`. Throws a
 * "too-long" ShareError past MAX_SHARE_URL_LENGTH.
 */
export async function buildShareUrl(
    results: Result[],
    origin: string,
): Promise<string> {
    const url = `${origin}/#${SHARE_HASH_KEY}=${await encodeCollection(results)}`;
    if (url.length > MAX_SHARE_URL_LENGTH) {
        throw new ShareError(
            "too-long",
            `${results.length} passages are too many to fit in a link. ` +
                "Share fewer, or send the Markdown file instead.",
        );
    }
    return url;
}

// ---- decode ----------------------------------------------------------------

function boundedString(value: unknown, max: number): string | undefined {
    return typeof value === "string" && value.length <= max ? value : undefined;
}

/** Rebuilds a passage from a link, or null when it isn't safe to show. */
export function fromWire(value: unknown): Result | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const e = value as Record<string, unknown>;
    const source = SOURCES.find((s) => s === e.s);
    const reference = boundedString(e.r, MAX_FIELD_LENGTH);
    const text = boundedString(e.x, MAX_TEXT_LENGTH);
    const url = boundedString(e.u, 2048);
    if (!source || !reference || !text?.trim() || !url) return null;
    if (!isAllowedSourceUrl(url)) return null;

    const metadata: Record<string, string | number> = {};
    if (e.m && typeof e.m === "object" && !Array.isArray(e.m)) {
        const m = e.m as Record<string, unknown>;
        for (const key of METADATA_KEYS) {
            const v = m[key];
            // `year` is the only field the date helpers do arithmetic on.
            if (key === "year") {
                if (Number.isInteger(v)) metadata[key] = v as number;
            } else if (typeof v === "string" && v.length <= MAX_FIELD_LENGTH) {
                metadata[key] = v;
            } else if (typeof v === "number" && Number.isFinite(v)) {
                metadata[key] = v;
            }
        }
    }

    const result: Result = {
        source,
        reference,
        text,
        title: boundedString(e.t, MAX_FIELD_LENGTH) ?? reference,
        url,
        // Relevance belongs to the query that found it; a link has none.
        score: 0,
        metadata: metadata as ResultMetadata,
    };
    const id = boundedString(e.i, 200);
    if (id) (result as Result & { id?: string }).id = id;
    return result;
}

export interface DecodedCollection {
    /** Usable passages, in the order they were shared. */
    bookmarks: Bookmark[];
    /** Entries dropped as malformed or pointing somewhere unexpected. */
    skipped: number;
}

/**
 * Reverses packToken, treating `token` as hostile: capped before and while
 * inflating. The JSON that comes back still needs checking field by field.
 * `what` names the thing in error messages ("collection", "answer").
 */
export async function unpackToken(token: string, what: string): Promise<unknown> {
    if (token.length > MAX_ENCODED_LENGTH) {
        throw new ShareError("too-large", `This ${what} is too large to open.`);
    }
    if (!token.startsWith(VERSION_PREFIX)) {
        throw new ShareError(
            "invalid",
            "This link was made by a newer or unknown version of Gospel Help.",
        );
    }
    if (!hasCompressionStreams()) {
        throw new ShareError(
            "unsupported",
            `This browser can't open shared ${what}s. Try an up-to-date Chrome, Edge, Firefox or Safari.`,
        );
    }

    const json = await inflate(
        fromBase64Url(token.slice(VERSION_PREFIX.length)),
        MAX_DECODED_BYTES,
        what,
    );
    try {
        return JSON.parse(json);
    } catch {
        throw new ShareError("invalid", "The link is incomplete or damaged.");
    }
}

/** Reverses encodeCollection, treating `token` as hostile. */
export async function decodeCollection(
    token: string,
): Promise<DecodedCollection> {
    const payload = await unpackToken(token, "collection");
    const entries =
        payload && typeof payload === "object"
            ? (payload as { p?: unknown }).p
            : undefined;
    if (!Array.isArray(entries)) {
        throw new ShareError("invalid", "The link is incomplete or damaged.");
    }
    if (entries.length > MAX_ENTRIES) {
        throw new ShareError(
            "too-large",
            "This collection has too many passages to open.",
        );
    }

    const seen = new Set<string>();
    const bookmarks: Bookmark[] = [];
    let skipped = 0;
    entries.forEach((entry, index) => {
        const result = fromWire(entry);
        const bookmark = result && {
            id: bookmarkId(result),
            // Newest first means the first shared passage gets the latest
            // stamp; importBookmarks restamps on save anyway.
            savedAt: entries.length - index,
            result,
        };
        if (!bookmark || !isBookmark(bookmark) || seen.has(bookmark.id)) {
            skipped++;
            return;
        }
        seen.add(bookmark.id);
        bookmarks.push(bookmark);
    });
    if (bookmarks.length === 0) {
        throw new ShareError(
            "empty",
            "None of the passages in this link could be read.",
        );
    }
    return { bookmarks, skipped };
}

/**
 * The encoded token from a location hash like `#saved=v1.…` (or `#ask=…`
 * with `key` "ask"), or null.
 */
export function shareTokenFromHash(
    hash: string,
    key: string = SHARE_HASH_KEY,
): string | null {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const token = params.get(key);
    return token ? token : null;
}

export type ShareLinkState =
    | { status: "pending" }
    | { status: "ready"; url: string }
    | { status: "error"; error: ShareError };

/**
 * A share link for `input`, built ahead of time by `build`. Safari only lets
 * the clipboard and share sheet be used straight from a click, not after an
 * `await`, so the compression has to be done before the button is pressed.
 * `input` should keep its identity until it changes; `build` is read when
 * `input` changes.
 */
export function usePrebuiltLink<T>(
    input: T | null,
    build: (input: T) => Promise<string>,
): ShareLinkState {
    const [state, setState] = useState<{
        for: T;
        value: ShareLinkState;
    } | null>(null);

    useEffect(() => {
        if (input === null) return;
        let cancelled = false;
        build(input).then(
            (url) => {
                if (!cancelled)
                    setState({ for: input, value: { status: "ready", url } });
            },
            (e: unknown) => {
                if (cancelled) return;
                const error =
                    e instanceof ShareError
                        ? e
                        : new ShareError("invalid", "Couldn't make a share link.");
                setState({ for: input, value: { status: "error", error } });
            },
        );
        return () => {
            cancelled = true;
        };
        // `build` is a plain function; only a new input calls for a new link.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [input]);

    // A link built for an older input is never handed out.
    return state && input !== null && state.for === input
        ? state.value
        : { status: "pending" };
}

const buildCollectionUrl = (results: Result[]) =>
    buildShareUrl(results, window.location.origin);

/** The share link for a list of passages (see usePrebuiltLink). */
export function useShareLink(results: Result[], enabled = true): ShareLinkState {
    return usePrebuiltLink(
        enabled && results.length > 0 ? results : null,
        buildCollectionUrl,
    );
}
