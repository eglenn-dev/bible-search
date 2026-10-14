// Bookmarks for both layouts. There are no accounts, so "saved" means saved
// on this device: the list lives in localStorage and each entry carries the
// whole result, which lets the Saved tab render without calling the API.
//
// A tiny external store rather than React state so every card, the detail
// sheet, and the Saved tab stay in step, and so a change in another tab of
// the same browser shows up here too.

import { useSyncExternalStore } from "react";
import type { Result } from "./types";

export const BOOKMARKS_STORAGE_KEY = "gs-bookmarks";

export interface Bookmark {
    id: string;
    /** Epoch ms. */
    savedAt: number;
    result: Result;
}

function hash(text: string): string {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
        h = ((h << 5) + h) ^ text.charCodeAt(i);
    }
    return (h >>> 0).toString(36);
}

/**
 * Identity used before the API returned ids, and still the only one for
 * results saved back then. A URL alone is not enough (BYU Speeches passages
 * all link to the talk, not the paragraph), so the text hash tells passages
 * from the same talk apart.
 */
function legacyBookmarkId(result: Result): string {
    return `${result.source}:${result.url}:${hash(result.text)}`;
}

/** Stable identity for a result: the API's document id when it has one. */
export function bookmarkId(result: Result): string {
    return result.id ?? legacyBookmarkId(result);
}

/**
 * Every key a saved copy of this result could be stored under: its id, and
 * the older url+text key (bookmarks saved before ids existed keep that one).
 */
function bookmarkKeys(result: Result): string[] {
    const legacy = legacyBookmarkId(result);
    return result.id ? [result.id, legacy] : [legacy];
}

/** Every key `isSaved` matches against, for a list of bookmarks. */
export function savedKeySet(bookmarks: Bookmark[]): Set<string> {
    const keys = new Set<string>();
    for (const b of bookmarks) {
        keys.add(b.id);
        for (const key of bookmarkKeys(b.result)) keys.add(key);
    }
    return keys;
}

/** Whether `result` is saved, under its id or its pre-id key. */
export function isSaved(savedKeys: Set<string>, result: Result): boolean {
    return bookmarkKeys(result).some((key) => savedKeys.has(key));
}

/** The saved entry for `result`, if any (matched like `isSaved`). */
export function findBookmark(
    bookmarks: Bookmark[],
    result: Result,
): Bookmark | undefined {
    const keys = bookmarkKeys(result);
    return bookmarks.find(
        (b) =>
            keys.includes(b.id) ||
            bookmarkKeys(b.result).some((key) => keys.includes(key)),
    );
}

/** Shape check for anything read back from storage or a shared link. */
export function isBookmark(value: unknown): value is Bookmark {
    if (!value || typeof value !== "object") return false;
    const b = value as Partial<Bookmark>;
    return (
        typeof b.id === "string" &&
        typeof b.savedAt === "number" &&
        !!b.result &&
        typeof b.result.source === "string" &&
        typeof b.result.reference === "string" &&
        typeof b.result.text === "string" &&
        typeof b.result.url === "string"
    );
}

// Parsed copy of what's in storage. useSyncExternalStore needs the same array
// back until something changes, so reads go through this.
let cache: Bookmark[] | null = null;
const listeners = new Set<() => void>();

function read(): Bookmark[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        cache = Array.isArray(parsed) ? parsed.filter(isBookmark) : [];
    } catch {
        // Unreadable storage or junk JSON — start empty.
        cache = [];
    }
    return cache;
}

function write(next: Bookmark[]): void {
    cache = next;
    try {
        localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Private mode or a full quota: the list still works for this visit.
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
        // key === null means storage was cleared wholesale.
        if (e.key === BOOKMARKS_STORAGE_KEY || e.key === null) {
            cache = null;
            listener();
        }
    };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

/** Saves the result, or removes it if it is already saved. */
export function toggleBookmark(result: Result): "added" | "removed" {
    const current = read();
    const existing = findBookmark(current, result);
    if (existing) {
        write(current.filter((b) => b !== existing));
        return "removed";
    }
    write([{ id: bookmarkId(result), savedAt: Date.now(), result }, ...current]);
    return "added";
}

/** Puts back bookmarks that were just removed (the toast's "Undo"). */
export function restoreBookmarks(removed: Bookmark[]): void {
    const current = read();
    const have = new Set(current.map((b) => b.id));
    const merged = [...current, ...removed.filter((b) => !have.has(b.id))];
    write(merged.sort((a, b) => b.savedAt - a.savedAt));
}

/** Removes one bookmark by its stored id. */
export function removeBookmark(id: string): void {
    const current = read();
    if (current.some((b) => b.id === id)) {
        write(current.filter((b) => b.id !== id));
    }
}

/**
 * Adds results that aren't saved yet (a shared collection's "Save all"),
 * keeping their order at the top of the list. Returns how many were new.
 */
export function importBookmarks(results: Result[]): number {
    const current = read();
    // Match like `isSaved`, so a passage saved before ids existed isn't
    // imported a second time under its new id.
    const have = savedKeySet(current);
    const now = Date.now();
    const added: Bookmark[] = [];
    for (const result of results) {
        if (isSaved(have, result)) continue;
        const id = bookmarkId(result);
        have.add(id);
        // One millisecond apart so newest-first keeps the shared order.
        added.push({ id, savedAt: now - added.length, result });
    }
    if (added.length > 0) write([...added, ...current]);
    return added.length;
}

export function clearBookmarks(): void {
    write([]);
}

/** The saved list, newest first. */
export function useBookmarks(): Bookmark[] {
    return useSyncExternalStore(subscribe, read);
}
