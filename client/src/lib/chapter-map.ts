export function getUrlChapter(reference: string): string {
    const otKeys = getOtKeys();
    const ntKeys = getNtKeys();

    if (
        reference.charAt(0) === "1" ||
        reference.charAt(0) === "2" ||
        reference.charAt(0) === "3"
    ) {
        const [bookNum, book, chapterVerse] = reference.split(" ");
        const [chapter, verse] = chapterVerse.split(":");
        if (ntKeys.includes(`${bookNum} ${book}`)) {
            return `nt/${
                ntChapterMap[`${bookNum} ${book}`]
            }/${chapter}?id=p${verse}#p${verse}`;
        } else if (otKeys.includes(`${bookNum} ${book}`)) {
            return `ot/${
                otChapterMap[`${bookNum} ${book}`]
            }/${chapter}?id=p${verse}#p${verse}`;
        }
    } else {
        const [book, chapterVerse] = reference.split(" ");
        const [chapter, verse] = chapterVerse.split(":");
        if (ntKeys.includes(book)) {
            return `nt/${ntChapterMap[book]}/${chapter}?id=p${verse}#p${verse}`;
        } else if (otKeys.includes(book)) {
            return `ot/${otChapterMap[book]}/${chapter}?id=p${verse}#p${verse}`;
        } else {
            console.warn(`Unknown book: ${book}`);
            return "";
        }
    }
    return "";
}

export function getOtKeys(): string[] {
    return Object.keys(otChapterMap);
}

export const otChapterMap: Record<string, string> = {
    Genesis: "gen",
    Exodus: "ex",
    Leviticus: "lev",
    Numbers: "num",
    Deuteronomy: "deut",
    Joshua: "josh",
    Judges: "judg",
    Ruth: "ruth",
    "1 Samuel": "1-sam",
    "2 Samuel": "2-sam",
    "1 Kings": "1-kgs",
    "2 Kings": "2-kgs",
    "1 Chronicles": "1-chr",
    "2 Chronicles": "2-chr",
    Ezra: "ezra",
    Nehemiah: "neh",
    Esther: "esth",
    Job: "job",
    Psalms: "ps",
    Proverbs: "prov",
    Ecclesiastes: "eccl",
    "Song of Solomon": "song",
    Isaiah: "isa",
    Jeremiah: "jer",
    Lamentations: "lam",
    Ezekiel: "ezek",
    Daniel: "dan",
    Hosea: "hosea",
    Joel: "joel",
    Amos: "amos",
    Obadiah: "obad",
    Jonah: "jonah",
    Micah: "micah",
    Nahum: "nahum",
    Habakkuk: "hab",
    Zephaniah: "zeph",
    Haggai: "hag",
    Zechariah: "zech",
    Malachi: "mal",
};

export function getNtKeys(): string[] {
    return Object.keys(ntChapterMap);
}

export const ntChapterMap: Record<string, string> = {
    Matthew: "matt",
    Mark: "mark",
    Luke: "luke",
    John: "john",
    Acts: "acts",
    Romans: "rom",
    "1 Corinthians": "1-cor",
    "2 Corinthians": "2-cor",
    Galatians: "gal",
    Ephesians: "eph",
    Philippians: "philip",
    Colossians: "col",
    "1 Thessalonians": "1-thes",
    "2 Thessalonians": "2-thes",
    "1 Timothy": "1-tim",
    "2 Timothy": "2-tim",
    Titus: "titus",
    Philemon: "philem",
    Hebrews: "heb",
    James: "james",
    "1 Peter": "1-pet",
    "2 Peter": "2-pet",
    "1 John": "1-jn",
    "2 John": "2-jn",
    "3 John": "3-jn",
    Jude: "jude",
    Revelation: "rev",
};
