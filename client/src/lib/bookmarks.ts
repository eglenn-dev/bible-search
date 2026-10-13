// Bookmarks for the mobile app. There are no accounts, so "saved" means saved
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
 * Stable identity for a result. The API returns no id, and a URL alone is not
 * enough: BYU Speeches passages all link to the talk, not the paragraph. The
 * text hash tells passages from the same talk apart.
 */
export function bookmarkId(result: Result): string {
    return `${result.source}:${result.url}:${hash(result.text)}`;
}

function isBookmark(value: unknown): value is Bookmark {
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
    const id = bookmarkId(result);
    const current = read();
    if (current.some((b) => b.id === id)) {
        write(current.filter((b) => b.id !== id));
        return "removed";
    }
    write([{ id, savedAt: Date.now(), result }, ...current]);
    return "added";
}

/** Puts back bookmarks that were just removed (the toast's "Undo"). */
export function restoreBookmarks(removed: Bookmark[]): void {
    const current = read();
    const have = new Set(current.map((b) => b.id));
    const merged = [...current, ...removed.filter((b) => !have.has(b.id))];
    write(merged.sort((a, b) => b.savedAt - a.savedAt));
}

export function clearBookmarks(): void {
    write([]);
}

/** The saved list, newest first. */
export function useBookmarks(): Bookmark[] {
    return useSyncExternalStore(subscribe, read);
}
