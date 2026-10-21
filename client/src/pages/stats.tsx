// The /stats page: precomputed corpus analytics rendered from GET /stats.
// All numbers are computed offline (api/ingest/stats.py); this page only
// formats and charts them.

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle";
import {
    BarList,
    BigNumber,
    Figure,
    LineChart,
    SpanChart,
    SparkRow,
} from "../components/stats/charts";
import { hideTip, showTip, useTipCleanup } from "../components/stats/tooltip";
import {
    fetchStats,
    fmt,
    VOLUME_COLOR,
    type StatsData,
    type StatsResponse,
    type TalkRef,
    type TwinPair,
    type VerseExtreme,
} from "../lib/stats";

const SECTIONS: [string, string][] = [
    ["speakers", "Speakers"],
    ["language", "Language"],
    ["trivia", "Trivia"],
    ["semantic", "Embeddings"],
];

/** The id of the section currently under the sticky nav. */
function useActiveSection(ready: boolean) {
    const [active, setActive] = useState(SECTIONS[0][0]);
    useEffect(() => {
        if (!ready) return;
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
            },
            // A thin band just below the nav: whichever section crosses it wins.
            { rootMargin: "-20% 0px -75% 0px" },
        );
        for (const [id] of SECTIONS) {
            const el = document.getElementById(id);
            if (el) io.observe(el);
        }
        return () => io.disconnect();
    }, [ready]);
    return active;
}

function Section({
    id,
    no,
    title,
    note,
    tinted = false,
    children,
}: {
    id: string;
    no: string;
    title: string;
    note: string;
    tinted?: boolean;
    children: ReactNode;
}) {
    return (
        <section id={id} className={`scroll-mt-14 ${tinted ? "bg-muted" : ""}`}>
            <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:py-24">
                <header className="mb-12 max-w-[64ch]">
                    <div className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                        {no}
                    </div>
                    <h2 className="mt-2 font-display text-[34px] font-medium leading-tight sm:text-[42px]">
                        {title}
                    </h2>
                    <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{note}</p>
                </header>
                <div className="grid gap-x-12 gap-y-16 md:grid-cols-2">{children}</div>
            </div>
        </section>
    );
}

/** Small uppercase label for a sub-list inside a figure. */
function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`mb-1 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground ${className}`}
        >
            {children}
        </div>
    );
}

/** Ranked list of talks: rank, linked title, then speaker/year/extra. */
function TalkList({ talks, accent }: { talks: TalkRef[]; accent?: string }) {
    return (
        <ol>
            {talks.map((t, i) => (
                <li
                    key={t.url}
                    className="grid grid-cols-[1.75rem_1fr] gap-2 border-b border-border/70 py-3 first:pt-0 last:border-b-0"
                >
                    <span
                        className="pt-0.5 font-display text-lg tabular-nums"
                        style={{ color: accent ?? "var(--primary)" }}
                    >
                        {i + 1}
                    </span>
                    <div className="min-w-0">
                        <a
                            href={t.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-display text-[19px] leading-snug text-foreground hover:text-primary hover:underline hover:underline-offset-[3px]"
                        >
                            {t.title}
                        </a>
                        <div className="mt-0.5 text-sm text-muted-foreground">
                            {t.speaker}, {t.year}
                            {t.words != null && <> · {fmt.format(t.words)} words</>}
                            {t.sim != null && <> · similarity {t.sim}</>}
                        </div>
                    </div>
                </li>
            ))}
        </ol>
    );
}

function PairRow({ pair }: { pair: TwinPair }) {
    const side = (t: TalkRef, align: string) => (
        <div className={`min-w-0 ${align}`}>
            <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-[18px] leading-snug text-foreground hover:text-primary hover:underline hover:underline-offset-[3px]"
            >
                {t.title}
            </a>
            <div className="text-sm text-muted-foreground">
                {t.speaker}, {t.year}
            </div>
        </div>
    );
    return (
        <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-b border-border/70 py-4 last:border-b-0 sm:grid-cols-[1fr_auto_1fr] sm:gap-x-6">
            {side(pair.a, "sm:text-right")}
            <div className="row-span-2 rounded-full bg-accent px-3 py-1 text-[15px] font-semibold tabular-nums text-primary sm:row-span-1">
                {(pair.sim * 100).toFixed(1)}%
            </div>
            {side(pair.b, "")}
        </div>
    );
}

function VerseQuote({ v, accent }: { v: VerseExtreme; accent: string }) {
    return (
        <div className="grid gap-x-8 gap-y-1 border-b border-border/70 py-4 last:border-b-0 sm:grid-cols-[13rem_1fr]">
            <div>
                <div className="font-display text-xl font-medium leading-snug">{v.ref}</div>
                <div className="text-sm tabular-nums" style={{ color: accent }}>
                    {v.words} words
                </div>
            </div>
            <div className="font-display text-[17px] leading-relaxed text-foreground/90">
                “{v.text}”
            </div>
        </div>
    );
}

const toSeries = (rec: Record<string, number>): [number, number][] =>
    Object.entries(rec).map(([y, v]) => [Number(y), v]);

export default function StatsPage() {
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [error, setError] = useState(false);
    const active = useActiveSection(stats !== null);
    useTipCleanup();

    useEffect(() => {
        fetchStats().then(setStats).catch(() => setError(true));
    }, []);

    if (error)
        return (
            <div className="flex min-h-screen flex-col">
                <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
                    <p className="text-lg">The stats are unavailable right now.</p>
                    <Link to="/" className="text-primary underline underline-offset-[3px]">
                        Back to search
                    </Link>
                </main>
                <Footer />
            </div>
        );

    if (!stats)
        return (
            <div className="flex min-h-screen items-center justify-center text-lg text-muted-foreground">
                Counting the library…
            </div>
        );

    const d: StatsData = stats.data;
    const m = d.meta;
    const updated = new Date(stats.generated_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    const verses =
        m.sources.bible +
        m.sources.book_of_mormon +
        m.sources.doctrine_and_covenants +
        m.sources.pearl_of_great_price;

    // Cluster mini-bars share one scale: the largest decade-share of any cluster.
    const maxClusterShare = Math.max(
        ...d.clusters.flatMap((c) =>
            Object.entries(d.cluster_decade_totals).map(
                ([dec, total]) => ((c.by_decade[dec] ?? 0) / total) * 100,
            ),
        ),
    );

    const speakerTip = (r: StatsData["prolific"][number]) =>
        `<b>${r.speaker}</b><br>${fmt.format(r.avg_words)} avg words · ${r.talks} talks · ${r.first}–${r.last}`;

    return (
        <div className="gs-fade flex min-h-screen flex-col">
            <header className="border-b border-border bg-background">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
                    <Link
                        to="/"
                        className="font-display text-[26px] text-foreground transition-colors hover:text-primary"
                    >
                        Gospel Help
                    </Link>
                    <div className="flex items-center gap-4">
                        <Link
                            to="/"
                            className="text-sm text-primary underline hover:text-primary-strong"
                        >
                            ← Back to search
                        </Link>
                        <ThemeToggle compact />
                    </div>
                </div>
            </header>

            <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-14 sm:pb-20 sm:pt-20">
                <div className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                    Gospel Library Search
                </div>
                <h1 className="mb-4 mt-3 font-display text-[44px] font-medium leading-[1.05] sm:text-6xl">
                    The Library, by the Numbers
                </h1>
                <p className="max-w-[58ch] text-lg leading-relaxed text-muted-foreground sm:text-xl">
                    Every stat on this page is computed from the full corpus behind the
                    search index — four volumes of scripture, {m.conference_years[1] - m.conference_years[0]}{" "}
                    years of General Conference, and five decades of BYU Speeches.
                </p>
                <p className="mt-3 text-sm text-muted-foreground">Data last updated {updated}.</p>

                <div className="mt-12 border-y border-border py-8">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
                        <BigNumber value={fmt.format(m.total_docs)} label="passages indexed" />
                        <BigNumber
                            value={`${(m.total_words / 1e6).toFixed(1)} M`}
                            label="words of text"
                        />
                        <BigNumber value={fmt.format(m.talks)} label="conference talks" />
                        <BigNumber value={fmt.format(m.speeches)} label="BYU speeches" />
                    </div>
                    <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-t border-border/70 pt-6 sm:grid-cols-4">
                        <BigNumber size="sm" value={fmt.format(verses)} label="verses of scripture" />
                        <BigNumber
                            size="sm"
                            value={fmt.format(m.conference_speakers)}
                            label="conference speakers"
                        />
                        <BigNumber
                            size="sm"
                            value={`${m.conference_years[0]}–${m.conference_years[1]}`}
                            label="years of conference"
                        />
                    </div>
                </div>
            </div>

            <nav className="sticky top-0 z-30 border-y border-border bg-background/85 backdrop-blur-md">
                <div className="mx-auto flex w-full max-w-5xl gap-0.5 overflow-x-auto px-2 py-2 [scrollbar-width:none] sm:gap-1 sm:px-4">
                    {SECTIONS.map(([id, label], i) => (
                        <a
                            key={id}
                            href={`#${id}`}
                            aria-current={active === id ? "true" : undefined}
                            className={`flex-none rounded-full px-3 py-1.5 text-[15px] transition-colors sm:px-3.5 ${
                                active === id
                                    ? "bg-accent font-semibold text-primary"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <span className="mr-1.5 hidden tabular-nums opacity-60 sm:inline">{i + 1}</span>
                            {label}
                        </a>
                    ))}
                </div>
            </nav>

            <main className="flex-1">
                <Section
                    id="speakers"
                    no="§ 1 · Speakers"
                    title="The Speakers"
                    note={`Who has held the conference pulpit since ${m.conference_years[0]} — procedural items (sustainings, audit & statistical reports) are excluded throughout.`}
                >
                    <Figure title="Most talks given" sub={`Distinct conference talks, ${m.conference_years[0]}–${m.conference_years[1]}.`}>
                        <BarList
                            rows={d.prolific.slice(0, 14).map((r) => ({
                                label: r.speaker,
                                value: r.talks,
                                tip: `<b>${r.speaker}</b><br>${r.talks} talks · ${r.first}–${r.last}<br>avg ${fmt.format(r.avg_words)} words`,
                            }))}
                        />
                    </Figure>
                    <Figure title="Longest pulpit careers" sub="First talk to most recent talk in the corpus.">
                        <SpanChart rows={d.longest_span.slice(0, 12)} domain={m.conference_years} />
                    </Figure>
                    <Figure title="Longest-winded" sub="Average words per talk (speakers with ≥ 10 talks).">
                        <BarList
                            rows={d.wordiest.slice(0, 8).map((r) => ({
                                label: r.speaker,
                                value: r.avg_words,
                                valText: `${fmt.format(r.avg_words)} w`,
                                tip: speakerTip(r),
                            }))}
                        />
                    </Figure>
                    <Figure title="Most concise" sub="Same measure, other end of the list.">
                        <BarList
                            rows={d.most_concise.slice(0, 8).map((r) => ({
                                label: r.speaker,
                                value: r.avg_words,
                                valText: `${fmt.format(r.avg_words)} w`,
                                color: "var(--series-3)",
                                tip: speakerTip(r),
                            }))}
                        />
                    </Figure>
                    <Figure className="md:col-span-2" title="The shrinking conference talk" sub="Average words per talk, by year.">
                        <LineChart
                            series={[toSeries(d.talk_length_by_year)]}
                            height={240}
                            yFmt={(v) => String(Math.round(v / 100) * 100)}
                            tipFmt={(v) => `${fmt.format(Math.round(v))} words`}
                        />
                    </Figure>
                    <Figure className="md:col-span-2" title="Extremes" sub="The longest and shortest sermons in the corpus.">
                        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
                            <div>
                                <Kicker className="mb-3">Longest</Kicker>
                                <TalkList talks={d.longest_talks.slice(0, 3)} />
                            </div>
                            <div>
                                <Kicker className="mb-3">Shortest</Kicker>
                                <TalkList talks={d.shortest_talks.slice(0, 3)} accent="var(--series-3)" />
                            </div>
                        </div>
                    </Figure>
                </Section>

                <Section
                    id="language"
                    tinted
                    no="§ 2 · Language"
                    title="The Language of Conference"
                    note={`A Google-Ngrams view of the pulpit: every line is one term’s frequency per million words of conference talk, ${m.conference_years[0]}–${m.conference_years[1]}. Hover any line for exact values.`}
                >
                    <Figure className="md:col-span-2" title="Words over time" sub={`${Object.keys(d.word_trends).length} terms, each on its own scale — compare shapes, not heights.`}>
                        <div className="grid gap-x-12 md:grid-cols-2">
                            {Object.entries(d.word_trends).map(([term, byYear]) => (
                                <SparkRow key={term} term={term} points={toSeries(byYear)} />
                            ))}
                        </div>
                    </Figure>
                    <Figure title="Reading ease" sub="Flesch reading ease of all talks, by year (higher = plainer language).">
                        <LineChart
                            series={[
                                Object.entries(d.readability_by_year).map(
                                    ([y, v]): [number, number] => [Number(y), v.flesch],
                                ),
                            ]}
                            colors={["var(--series-3)"]}
                            yFmt={(v) => v.toFixed(0)}
                            tipFmt={(v) => `${v.toFixed(1)} Flesch`}
                        />
                    </Figure>
                    <Figure title="Sentence length" sub="Average words per sentence, by year.">
                        <LineChart
                            series={[
                                Object.entries(d.readability_by_year).map(
                                    ([y, v]): [number, number] => [Number(y), v.avg_sentence_len],
                                ),
                            ]}
                            colors={["var(--series-2)"]}
                            yFmt={(v) => v.toFixed(0)}
                            tipFmt={(v) => `${v.toFixed(1)} words/sentence`}
                        />
                    </Figure>
                    <Figure
                        className="md:col-span-2"
                        title="Vocabulary fingerprints"
                        sub="Words each current apostle uses far more than conference speakers as a whole (× lift over the corpus rate)."
                    >
                        <div>
                            {Object.entries(d.fingerprints).map(([speaker, words]) => (
                                <div
                                    key={speaker}
                                    className="grid gap-x-6 gap-y-2 border-b border-border/70 py-3 first:pt-0 last:border-b-0 sm:grid-cols-[12.5rem_1fr] sm:items-baseline"
                                >
                                    <div className="font-display text-[19px] font-medium">{speaker}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {words.slice(0, 6).map((w) => (
                                            <span
                                                key={w.word}
                                                className="whitespace-nowrap rounded-full bg-background px-3 py-0.5 text-[15px] ring-1 ring-border"
                                            >
                                                {w.word}{" "}
                                                <small className="tabular-nums text-muted-foreground">
                                                    ×{Math.round(w.lift)}
                                                </small>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Figure>
                </Section>

                <Section
                    id="trivia"
                    no="§ 3 · Trivia"
                    title="Scripture Trivia"
                    note={`Classic concordance facts, computed across all ${fmt.format(verses)} verses of the standard works.`}
                >
                    <Figure className="md:col-span-2" title="Shortest verses">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                            {d.shortest_verses.slice(0, 5).map((v) => (
                                <div
                                    key={v.ref}
                                    className="flex flex-col justify-between gap-4 rounded-xl bg-accent/60 px-4 py-4"
                                >
                                    <div className="font-display text-xl leading-snug">“{v.text}”</div>
                                    <div className="text-sm leading-snug">
                                        <div className="font-medium">{v.ref}</div>
                                        <div className="text-muted-foreground">{v.words} words</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Figure>
                    <Figure className="md:col-span-2" title="Longest verses">
                        {d.longest_verses.slice(0, 5).map((v) => (
                            <VerseQuote key={v.ref} v={v} accent="var(--series-2)" />
                        ))}
                    </Figure>
                    <Figure title="“And it came to pass”" sub="Occurrences by volume — and where the Book of Mormon keeps them.">
                        <BarList
                            rows={Object.entries(d.came_to_pass.by_volume).map(([vol, n]) => ({
                                label: vol,
                                value: n,
                                color: VOLUME_COLOR[vol] ?? "var(--primary)",
                            }))}
                        />
                        <Kicker className="mt-5">Within the Book of Mormon</Kicker>
                        <BarList
                            rows={Object.entries(d.came_to_pass.bom_by_book)
                                .slice(0, 6)
                                .map(([book, n]) => ({
                                    label: book,
                                    value: n,
                                    color: "var(--series-3)",
                                }))}
                        />
                    </Figure>
                    <Figure title="Biggest chapters" sub="Most verses in a single chapter.">
                        <BarList
                            rows={d.biggest_chapters.slice(0, 8).map((r) => ({
                                label: r.chapter,
                                value: r.verses,
                                valText: `${r.verses} verses`,
                            }))}
                        />
                    </Figure>
                </Section>

                <Section
                    id="semantic"
                    tinted
                    no="§ 4 · Embeddings"
                    title="What the Embeddings See"
                    note="These stats come from the same 384-dimensional vectors that power search — no keyword matching involved. Each talk is averaged into a single point; distance means semantic difference."
                >
                    <Figure title="The most typical talks" sub="Closest to the semantic center of every sermon in the corpus.">
                        <TalkList talks={d.most_typical.slice(0, 6)} />
                    </Figure>
                    <Figure title="The most unusual talks" sub="Farthest from the center — the outliers.">
                        <TalkList talks={d.most_unusual.slice(0, 6)} accent="var(--series-2)" />
                    </Figure>
                    <Figure className="md:col-span-2" title="Talk twins" sub="The most semantically similar pairs of talks by different speakers.">
                        {d.twins.slice(0, 6).map((p) => (
                            <PairRow key={p.a.url + p.b.url} pair={p} />
                        ))}
                    </Figure>
                    <Figure className="md:col-span-2" title="Twins across eras" sub="Near-identical talks given at least 25 years apart.">
                        {d.twins_cross_era.slice(0, 6).map((p) => (
                            <PairRow key={p.a.url + p.b.url} pair={p} />
                        ))}
                    </Figure>
                    <Figure
                        className="md:col-span-2"
                        title="Twelve rooms of the conference library"
                        sub="K-means clusters of all sermons, labeled by their most distinctive vocabulary. Bars show each cluster’s share of talks per decade."
                    >
                        {/* Each cluster spans three subgrid rows so headings, bars and
                            examples line up across a row of the grid. */}
                        <div className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
                            {d.clusters.map((c) => (
                                <div
                                    key={c.top_words.join()}
                                    className="row-span-3 grid grid-rows-subgrid pb-10"
                                >
                                    <div>
                                        <div className="font-display text-xl font-medium leading-snug">
                                            {c.top_words.slice(0, 3).join(" · ")}
                                        </div>
                                        <div className="mt-1 text-[15px] text-muted-foreground">
                                            {fmt.format(c.size)} talks — also:{" "}
                                            {c.top_words.slice(3, 7).join(", ")}
                                        </div>
                                    </div>
                                    <div className="flex h-[72px] items-end gap-1 pt-2">
                                        {Object.entries(d.cluster_decade_totals).map(([dec, total]) => {
                                            const share = ((c.by_decade[dec] ?? 0) / total) * 100;
                                            const barPx = Math.max(2, (share / maxClusterShare) * 52);
                                            return (
                                                <div
                                                    key={dec}
                                                    className="flex flex-1 flex-col justify-end"
                                                    onMouseMove={(ev) =>
                                                        showTip(
                                                            ev,
                                                            `${dec}s: ${c.by_decade[dec] ?? 0} talks (${share.toFixed(1)}% of decade)`,
                                                        )
                                                    }
                                                    onMouseLeave={hideTip}
                                                >
                                                    <div
                                                        className="rounded-t-sm bg-primary"
                                                        style={{ height: `${barPx}px` }}
                                                    />
                                                    <div className="mt-1 text-center text-[12.5px] tabular-nums text-muted-foreground">
                                                        {dec.slice(2)}s
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-2.5 text-[15px] text-muted-foreground">
                                        e.g.{" "}
                                        <a
                                            href={c.examples[0].url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary underline-offset-[3px] hover:underline"
                                        >
                                            {c.examples[0].title}
                                        </a>{" "}
                                        ({c.examples[0].year})
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Figure>
                    <Figure
                        className="md:col-span-2"
                        title="The most echoed verses"
                        // Stats generated before the threshold was recorded used 0.6.
                        sub={`For every conference passage, the semantically nearest verse of scripture (cosine > ${d.verse_echo_threshold ?? 0.6}). These are the verses the pulpit orbits — cited or not.`}
                    >
                        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[15px] text-muted-foreground">
                            {Object.entries(VOLUME_COLOR).map(([name, color]) => (
                                <span key={name}>
                                    <span
                                        className="mr-1.5 inline-block h-[11px] w-[11px] rounded-[3px] align-[-1px]"
                                        style={{ background: color }}
                                    />
                                    {name}
                                </span>
                            ))}
                        </div>
                        <BarList
                            wide
                            rows={d.verse_echo_strong.slice(0, 15).map((r) => ({
                                label: r.ref,
                                value: r.count,
                                valText: `${fmt.format(r.count)} passages`,
                                color: VOLUME_COLOR[r.volume],
                                tip: `<b>${r.ref}</b> is the nearest verse to ${r.count} conference passages${r.text ? `<br><i>“${r.text}…”</i>` : ""}`,
                            }))}
                        />
                    </Figure>
                </Section>
            </main>
            <Footer />
        </div>
    );
}
