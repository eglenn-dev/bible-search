// The /stats page: precomputed corpus analytics rendered from GET /stats.
// All numbers are computed offline (api/ingest/stats.py); this page only
// formats and charts them.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle";
import {
    BarList,
    LineChart,
    SpanChart,
    SparkPanel,
    StatCard,
    Tile,
} from "../components/stats/charts";
import { hideTip, showTip, useTipCleanup } from "../components/stats/tooltip";
import {
    fetchStats,
    fmt,
    VOLUME_COLOR,
    volumeOfRef,
    type StatsData,
    type StatsResponse,
    type TalkRef,
    type TwinPair,
} from "../lib/stats";

const SECTIONS: [string, string][] = [
    ["speakers", "§1 Speakers"],
    ["language", "§2 Language"],
    ["citations", "§3 Citations"],
    ["trivia", "§4 Trivia"],
    ["semantic", "§5 Embeddings"],
];

function SectionHead({ no, title, note }: { no: string; title: string; note: string }) {
    return (
        <>
            <div className="mb-1.5 flex items-baseline gap-3.5 border-b-2 border-foreground pb-2">
                <span className="text-[15px] uppercase tracking-[0.2em] text-muted-foreground">
                    {no}
                </span>
                <h2 className="font-display text-[34px] font-medium">{title}</h2>
            </div>
            <p className="mb-6 mt-2.5 max-w-[68ch] text-lg text-muted-foreground">{note}</p>
        </>
    );
}

function TalkCard({ talk, accent }: { talk: TalkRef; accent?: string }) {
    return (
        <div
            className="my-2.5 border-l-[3px] py-1 pl-3.5"
            style={{ borderColor: accent ?? "var(--primary)" }}
        >
            <a
                href={talk.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display text-xl font-medium text-primary hover:underline hover:underline-offset-[3px]"
            >
                {talk.title}
            </a>
            <div className="text-[15px] italic text-muted-foreground">
                {talk.speaker}, {talk.year}
                {talk.words != null && <> — {fmt.format(talk.words)} words</>}
                {talk.sim != null && <> · similarity {talk.sim}</>}
            </div>
        </div>
    );
}

function PairRow({ pair }: { pair: TwinPair }) {
    const side = (t: TalkRef) => (
        <div>
            <a
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[17px] leading-snug text-primary hover:underline hover:underline-offset-[3px]"
            >
                {t.title}
            </a>
            <div className="text-[15px] text-muted-foreground">
                {t.speaker}, {t.year}
            </div>
        </div>
    );
    return (
        <div className="grid grid-cols-1 items-center gap-2.5 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[1fr_auto_1fr]">
            {side(pair.a)}
            <div className="text-[17px] font-semibold tabular-nums text-primary sm:text-center">
                {(pair.sim * 100).toFixed(1)}%
            </div>
            {side(pair.b)}
        </div>
    );
}

const toSeries = (rec: Record<string, number>): [number, number][] =>
    Object.entries(rec).map(([y, v]) => [Number(y), v]);

export default function StatsPage() {
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [error, setError] = useState(false);
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
            <div className="flex min-h-screen items-center justify-center text-lg italic text-muted-foreground">
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

    return (
        <div className="gs-fade flex min-h-screen flex-col">
            <header className="border-b border-border bg-background/95">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-4">
                    <Link
                        to="/"
                        className="font-display text-2xl font-medium italic text-foreground transition-colors hover:text-primary"
                    >
                        Gospel Help
                    </Link>
                    <div className="flex items-center gap-4">
                        <Link
                            to="/"
                            className="text-[15px] text-primary underline-offset-[3px] hover:underline"
                        >
                            ← Back to search
                        </Link>
                        <ThemeToggle compact />
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-24">
                <section className="pt-12">
                    <div className="text-sm uppercase tracking-[0.28em] text-muted-foreground">
                        Gospel Library Search
                    </div>
                    <h1 className="mb-3 mt-2 font-display text-4xl font-medium sm:text-5xl">
                        The Library, by the Numbers
                    </h1>
                    <p className="max-w-[62ch] text-lg text-muted-foreground">
                        Every stat on this page is computed from the full corpus behind the
                        search index — four volumes of scripture, {m.conference_years[1] - m.conference_years[0]}{" "}
                        years of General Conference, and five decades of BYU Speeches.
                    </p>
                    <p className="mt-2 text-[15px] italic text-muted-foreground">
                        Data last updated {updated}.
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                        <Tile value={fmt.format(m.total_docs)} label="passages indexed" />
                        <Tile
                            value={`${(m.total_words / 1e6).toFixed(1)} M`}
                            label="words of text"
                        />
                        <Tile value={fmt.format(m.talks)} label="conference talks" />
                        <Tile value={fmt.format(m.speeches)} label="BYU speeches" />
                        <Tile value={fmt.format(verses)} label="verses of scripture" />
                        <Tile
                            value={fmt.format(m.conference_speakers)}
                            label="conference speakers"
                        />
                        <Tile
                            value={`${m.conference_years[0]}–${m.conference_years[1]}`}
                            label="years of conference"
                        />
                    </div>
                    <nav className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4">
                        {SECTIONS.map(([id, label]) => (
                            <a
                                key={id}
                                href={`#${id}`}
                                className="text-lg text-primary underline-offset-[3px] hover:underline"
                            >
                                {label}
                            </a>
                        ))}
                    </nav>
                </section>

                {/* §1 Speakers */}
                <section id="speakers" className="mt-16 scroll-mt-6">
                    <SectionHead
                        no="§ 1"
                        title="The Speakers"
                        note={`Who has held the conference pulpit since ${m.conference_years[0]} — procedural items (sustainings, audit & statistical reports) are excluded throughout.`}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard title="Most talks given" sub={`Distinct conference talks, ${m.conference_years[0]}–${m.conference_years[1]}.`}>
                            <BarList
                                rows={d.prolific.slice(0, 14).map((r) => ({
                                    label: r.speaker,
                                    value: r.talks,
                                    tip: `<b>${r.speaker}</b><br>${r.talks} talks · ${r.first}–${r.last}<br>avg ${fmt.format(r.avg_words)} words`,
                                }))}
                            />
                        </StatCard>
                        <StatCard title="Longest pulpit careers" sub="First talk to most recent talk in the corpus.">
                            <SpanChart
                                rows={d.longest_span.slice(0, 12)}
                                domain={m.conference_years}
                            />
                        </StatCard>
                        <StatCard title="Longest-winded" sub="Average words per talk (speakers with ≥ 10 talks).">
                            <BarList
                                rows={d.wordiest.slice(0, 8).map((r) => ({
                                    label: r.speaker,
                                    value: r.avg_words,
                                    valText: `${fmt.format(r.avg_words)} w`,
                                    tip: `<b>${r.speaker}</b><br>${fmt.format(r.avg_words)} avg words · ${r.talks} talks · ${r.first}–${r.last}`,
                                }))}
                            />
                        </StatCard>
                        <StatCard title="Most concise" sub="Same measure, other end of the list.">
                            <BarList
                                rows={d.most_concise.slice(0, 8).map((r) => ({
                                    label: r.speaker,
                                    value: r.avg_words,
                                    valText: `${fmt.format(r.avg_words)} w`,
                                    color: "var(--series-3)",
                                    tip: `<b>${r.speaker}</b><br>${fmt.format(r.avg_words)} avg words · ${r.talks} talks · ${r.first}–${r.last}`,
                                }))}
                            />
                        </StatCard>
                        <StatCard title="The shrinking conference talk" sub="Average words per talk, by year.">
                            <LineChart
                                series={[toSeries(d.talk_length_by_year)]}
                                yFmt={(v) => String(Math.round(v / 100) * 100)}
                                tipFmt={(v) => `${fmt.format(Math.round(v))} words`}
                            />
                        </StatCard>
                        <StatCard title="Extremes" sub="The longest and shortest sermons in the corpus.">
                            <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Longest
                            </div>
                            {d.longest_talks.slice(0, 3).map((t) => (
                                <TalkCard key={t.url} talk={t} />
                            ))}
                            <div className="mt-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Shortest
                            </div>
                            {d.shortest_talks.slice(0, 3).map((t) => (
                                <TalkCard key={t.url} talk={t} accent="var(--series-3)" />
                            ))}
                        </StatCard>
                    </div>
                </section>

                {/* §2 Language */}
                <section id="language" className="mt-16 scroll-mt-6">
                    <SectionHead
                        no="§ 2"
                        title="The Language of Conference"
                        note={`A Google-Ngrams view of the pulpit: every panel is one term’s frequency per million words of conference talk, ${m.conference_years[0]}–${m.conference_years[1]}. Hover any panel for exact values.`}
                    />
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(235px,1fr))] gap-3">
                        {Object.entries(d.word_trends).map(([term, byYear]) => (
                            <SparkPanel key={term} term={term} points={toSeries(byYear)} />
                        ))}
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <StatCard title="Reading ease" sub="Flesch reading ease of all talks, by year (higher = plainer language).">
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
                        </StatCard>
                        <StatCard title="Sentence length" sub="Average words per sentence, by year.">
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
                        </StatCard>
                    </div>
                    <StatCard
                        className="mt-4"
                        title="Vocabulary fingerprints"
                        sub="Words each speaker uses far more than everyone else combined (× lift over the corpus rate)."
                    >
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(d.fingerprints).slice(0, 12).map(([speaker, words]) => (
                                <div key={speaker}>
                                    <div className="mb-1.5 font-display text-xl font-medium">
                                        {speaker}
                                    </div>
                                    <div>
                                        {words.slice(0, 6).map((w) => (
                                            <span
                                                key={w.word}
                                                className="mb-1.5 mr-1 inline-block whitespace-nowrap rounded-full bg-accent px-3 py-0.5 text-[16px]"
                                            >
                                                {w.word}{" "}
                                                <small className="text-muted-foreground">
                                                    ×{Math.round(w.lift)}
                                                </small>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </StatCard>
                </section>

                {/* §3 Citations */}
                <section id="citations" className="mt-16 scroll-mt-6">
                    <SectionHead
                        no="§ 3"
                        title="What the Pulpit Quotes"
                        note="Every explicit scripture citation (“Alma 32:21”, “1 Ne. 3:7”, “Matt. 5:48”) found in the body text of conference talks, colored by volume. Modern talks keep citations in footnotes, so counts lean toward earlier decades."
                    />
                    <div className="mb-3.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[15px] text-muted-foreground">
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
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard title="The most-quoted verses" sub="All-time citation count in conference talks.">
                            <BarList
                                rows={d.top_verses.slice(0, 20).map((r) => ({
                                    label: r.ref,
                                    value: r.count,
                                    color: VOLUME_COLOR[volumeOfRef(r.ref, d.book_citations)],
                                    tip: `<b>${r.ref}</b><br>cited ${r.count} times in conference`,
                                }))}
                            />
                        </StatCard>
                        <StatCard title="The most-quoted books" sub="Citations per book (top 25).">
                            <BarList
                                rows={d.book_citations.slice(0, 25).map((r) => ({
                                    label: r.book,
                                    value: r.count,
                                    color: VOLUME_COLOR[r.volume],
                                    tip: `<b>${r.book}</b> (${r.volume})<br>${fmt.format(r.count)} citations`,
                                }))}
                            />
                        </StatCard>
                        <StatCard title="Signature verse of each decade" sub="Top-cited verses by decade of conference.">
                            <table className="w-full border-collapse text-[17px]">
                                <thead>
                                    <tr>
                                        {["Decade", "Top verses"].map((h) => (
                                            <th
                                                key={h}
                                                className="border-b border-border pb-2 pr-2.5 text-left text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(d.top_verse_by_decade).map(([dec, list]) => (
                                        <tr key={dec}>
                                            <td className="border-b border-border/50 py-2 pr-2.5 font-semibold tabular-nums">
                                                {dec}s
                                            </td>
                                            <td className="border-b border-border/50 py-2">
                                                {list.slice(0, 3).map((v, i) => (
                                                    <span key={v.ref}>
                                                        {i > 0 && " · "}
                                                        {v.ref}{" "}
                                                        <span className="text-muted-foreground">({v.count})</span>
                                                    </span>
                                                ))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </StatCard>
                        <StatCard title="The uncited" sub={`Books never (or barely) cited from the pulpit since ${m.conference_years[0]}.`}>
                            <div className="mb-3 rounded-lg bg-accent px-4 py-3 text-[17px] leading-relaxed">
                                <b>Never cited:</b> {d.never_cited_books.join(", ") || "—"}
                            </div>
                            {d.least_cited_books.slice(0, 10).map((b) => (
                                <div
                                    key={b.book}
                                    className="flex items-baseline justify-between border-b border-border/50 py-1.5 text-[17px] last:border-b-0"
                                >
                                    <span>
                                        {b.book}{" "}
                                        <span className="text-muted-foreground">· {b.volume}</span>
                                    </span>
                                    <span className="tabular-nums">{b.count}</span>
                                </div>
                            ))}
                        </StatCard>
                    </div>
                </section>

                {/* §4 Trivia */}
                <section id="trivia" className="mt-16 scroll-mt-6">
                    <SectionHead
                        no="§ 4"
                        title="Scripture Trivia"
                        note={`Classic concordance facts, computed across all ${fmt.format(verses)} verses of the standard works.`}
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard title="Shortest verses">
                            {d.shortest_verses.slice(0, 5).map((v) => (
                                <div key={v.ref} className="my-3 border-l-[3px] border-primary py-1 pl-3.5">
                                    <span className="font-display text-xl font-medium">{v.ref}</span>{" "}
                                    <span className="text-[15px] text-muted-foreground">
                                        · {v.words} words
                                    </span>
                                    <div className="text-lg italic text-muted-foreground">
                                        “{v.text}”
                                    </div>
                                </div>
                            ))}
                        </StatCard>
                        <StatCard title="Longest verses">
                            {d.longest_verses.slice(0, 5).map((v) => (
                                <div
                                    key={v.ref}
                                    className="my-3 border-l-[3px] py-1 pl-3.5"
                                    style={{ borderColor: "var(--series-2)" }}
                                >
                                    <span className="font-display text-xl font-medium">{v.ref}</span>{" "}
                                    <span className="text-[15px] text-muted-foreground">
                                        · {v.words} words
                                    </span>
                                    <div className="text-lg italic text-muted-foreground">
                                        “{v.text}”
                                    </div>
                                </div>
                            ))}
                        </StatCard>
                        <StatCard title="“And it came to pass”" sub="Occurrences by volume — and where the Book of Mormon keeps them.">
                            <BarList
                                rows={Object.entries(d.came_to_pass.by_volume).map(([vol, n]) => ({
                                    label: vol,
                                    value: n,
                                    color: VOLUME_COLOR[vol] ?? "var(--primary)",
                                }))}
                            />
                            <div className="mb-1 mt-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                Within the Book of Mormon
                            </div>
                            <BarList
                                rows={Object.entries(d.came_to_pass.bom_by_book)
                                    .slice(0, 6)
                                    .map(([book, n]) => ({
                                        label: book,
                                        value: n,
                                        color: "var(--series-3)",
                                    }))}
                            />
                        </StatCard>
                        <StatCard title="Biggest chapters" sub="Most verses in a single chapter.">
                            <BarList
                                rows={d.biggest_chapters.slice(0, 8).map((r) => ({
                                    label: r.chapter,
                                    value: r.verses,
                                    valText: `${r.verses} verses`,
                                }))}
                            />
                        </StatCard>
                    </div>
                </section>

                {/* §5 Embeddings */}
                <section id="semantic" className="mt-16 scroll-mt-6">
                    <SectionHead
                        no="§ 5"
                        title="What the Embeddings See"
                        note="These stats come from the same 384-dimensional vectors that power search — no keyword matching involved. Each talk is averaged into a single point; distance means semantic difference."
                    />
                    <div className="grid gap-4 md:grid-cols-2">
                        <StatCard title="The most typical talks" sub="Closest to the semantic center of every sermon in the corpus.">
                            {d.most_typical.slice(0, 6).map((t) => (
                                <TalkCard key={t.url} talk={t} />
                            ))}
                        </StatCard>
                        <StatCard title="The most unusual talks" sub="Farthest from the center — the outliers.">
                            {d.most_unusual.slice(0, 6).map((t) => (
                                <TalkCard key={t.url} talk={t} accent="var(--series-2)" />
                            ))}
                        </StatCard>
                        <StatCard title="Talk twins" sub="The most semantically similar pairs of talks by different speakers.">
                            {d.twins.slice(0, 6).map((p) => (
                                <PairRow key={p.a.url + p.b.url} pair={p} />
                            ))}
                        </StatCard>
                        <StatCard title="Twins across eras" sub="Near-identical talks given at least 25 years apart.">
                            {d.twins_cross_era.slice(0, 6).map((p) => (
                                <PairRow key={p.a.url + p.b.url} pair={p} />
                            ))}
                        </StatCard>
                    </div>
                    <StatCard
                        className="mt-4"
                        title="Twelve rooms of the conference library"
                        sub="K-means clusters of all sermons, labeled by their most distinctive vocabulary. Bars show each cluster’s share of talks per decade."
                    >
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {d.clusters.map((c) => (
                                <div key={c.top_words.join()} className="rounded-lg border border-border px-4 py-3.5">
                                    <div className="font-display text-xl font-medium leading-snug">
                                        {c.top_words.slice(0, 3).join(" · ")}
                                    </div>
                                    <div className="mb-2.5 mt-1 text-[15px] text-muted-foreground">
                                        {fmt.format(c.size)} talks — also:{" "}
                                        {c.top_words.slice(3, 7).join(", ")}
                                    </div>
                                    <div className="flex h-[72px] items-end gap-1">
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
                                                    <div className="text-center text-[12.5px] tabular-nums text-muted-foreground">
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
                    </StatCard>
                    <StatCard
                        className="mt-4"
                        title="The most echoed verses"
                        sub="For every conference passage, the semantically nearest verse of scripture (cosine > 0.6). These are the verses the pulpit orbits — cited or not."
                    >
                        <BarList
                            rows={d.verse_echo_strong.slice(0, 15).map((r) => ({
                                label: r.ref,
                                value: r.count,
                                valText: `${fmt.format(r.count)} passages`,
                                color: VOLUME_COLOR[volumeOfRef(r.ref, d.book_citations)],
                                tip: `<b>${r.ref}</b> is the nearest verse to ${r.count} conference passages${r.text ? `<br><i>“${r.text}…”</i>` : ""}`,
                            }))}
                        />
                    </StatCard>
                </section>
            </main>
            <Footer />
        </div>
    );
}
