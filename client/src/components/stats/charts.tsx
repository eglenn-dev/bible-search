// Lightweight SVG/CSS chart primitives for the stats page. No chart library:
// the shapes are simple enough that hand-rolled SVG keeps the bundle small and
// the styling on-theme (all colors come from CSS custom properties).

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { fmt } from "../../lib/stats";
import { hideTip, showTip } from "./tooltip";

// --- Horizontal bar list --------------------------------------------------

export interface BarRow {
    label: ReactNode;
    value: number;
    valText?: string;
    color?: string;
    tip?: string;
}

export function BarList({ rows, wide = false }: { rows: BarRow[]; wide?: boolean }) {
    const max = Math.max(...rows.map((r) => r.value));
    return (
        <div>
            {rows.map((r, i) => (
                <div
                    key={i}
                    className={`my-2 grid items-center gap-2.5 ${
                        wide
                            ? "grid-cols-[minmax(120px,50%)_1fr] sm:grid-cols-[minmax(150px,24%)_1fr]"
                            : "grid-cols-[minmax(120px,50%)_1fr] sm:grid-cols-[minmax(125px,42%)_1fr]"
                    }`}
                    onMouseMove={r.tip ? (ev) => showTip(ev, r.tip!) : undefined}
                    onMouseLeave={r.tip ? hideTip : undefined}
                >
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[17px] leading-snug">
                        {r.label}
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <div
                                className="h-3.5 rounded-r"
                                style={{
                                    width: `${Math.max(1.2, (r.value / max) * 100)}%`,
                                    background: r.color ?? "var(--primary)",
                                }}
                            />
                        </div>
                        <span className="flex-none whitespace-nowrap text-[15px] tabular-nums text-muted-foreground">
                            {r.valText ?? fmt.format(r.value)}
                        </span>
                    </div>
                </div>
            ))}
        </div>
    );
}

// --- Line chart with crosshair tooltip ------------------------------------

export interface LineChartProps {
    /** [x, y] points, ascending x. Multiple series share the x domain. */
    series: [number, number][][];
    names?: string[];
    colors?: string[];
    yFmt?: (v: number) => string;
    tipFmt?: (v: number) => string;
    /** Force the y-axis to start at this value (e.g. 0). */
    yMin?: number;
    height?: number;
}

export function LineChart({
    series,
    names = [],
    colors = ["var(--primary)"],
    yFmt = (v) => fmt.format(Math.round(v)),
    tipFmt,
    yMin: yMinProp,
    height = 190,
}: LineChartProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [cursor, setCursor] = useState<number | null>(null);
    // Draw in real pixels so axis text stays the same size whether the chart
    // fills a half-width column or the full page.
    const w = useWidth(svgRef, 480);
    const h = height;
    const P = { l: 50, r: 10, t: 10, b: 26 };
    const xs = series[0].map((p) => p[0]);
    const allY = series.flat().map((p) => p[1]);
    const yMin = yMinProp ?? Math.min(...allY) * 0.97;
    const yMax = Math.max(...allY) * 1.03;
    const X = (x: number) =>
        P.l + ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * (w - P.l - P.r);
    const Y = (y: number) => P.t + (1 - (y - yMin) / (yMax - yMin)) * (h - P.t - P.b);

    const onMove = (ev: React.MouseEvent<SVGSVGElement>) => {
        const rect = svgRef.current!.getBoundingClientRect();
        const mx = ((ev.clientX - rect.left) / rect.width) * w;
        let best = 0;
        let bd = Infinity;
        xs.forEach((x, i) => {
            const d = Math.abs(X(x) - mx);
            if (d < bd) {
                bd = d;
                best = i;
            }
        });
        setCursor(best);
        const rows = series
            .map(
                (pts, si) =>
                    `${names[si] ? `${names[si]}: ` : ""}<b>${(tipFmt ?? yFmt)(pts[best][1])}</b>`,
            )
            .join("<br>");
        showTip(ev, `${xs[best]}<br>${rows}`);
    };

    const yTicks = [0, 1, 2, 3, 4].map((i) => yMin + ((yMax - yMin) * i) / 4);
    const xStep = Math.ceil(xs.length / Math.max(3, Math.floor(w / 90)));
    const last = xs.length - 1;
    // Stepped labels, plus the final year — minus any stepped label that
    // would collide with it.
    const showX = (i: number) =>
        i === last || (i % xStep === 0 && X(xs[last]) - X(xs[i]) >= 64);

    return (
        <svg
            ref={svgRef}
            viewBox={`0 0 ${w} ${h}`}
            className="block h-auto w-full"
            onMouseMove={onMove}
            onMouseLeave={() => {
                setCursor(null);
                hideTip();
            }}
        >
            {yTicks.map((v, i) => (
                <g key={i}>
                    <line
                        x1={P.l}
                        x2={w - P.r}
                        y1={Y(v)}
                        y2={Y(v)}
                        stroke="var(--chart-grid)"
                    />
                    <text
                        x={P.l - 8}
                        y={Y(v) + 5}
                        textAnchor="end"
                        className="fill-muted-foreground text-[14px]"
                    >
                        {yFmt(v)}
                    </text>
                </g>
            ))}
            {xs.map((x, i) =>
                showX(i) ? (
                    <text
                        key={x}
                        x={X(x)}
                        y={h - 7}
                        textAnchor={i === last ? "end" : "middle"}
                        className="fill-muted-foreground text-[14px]"
                    >
                        {x}
                    </text>
                ) : null,
            )}
            {series.map((pts, si) => {
                const d = pts
                    .map((p, i) => `${i ? "L" : "M"}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`)
                    .join("");
                const color = colors[si] ?? colors[0];
                return (
                    <g key={si}>
                        {si === 0 && (
                            <path
                                d={`${d}L${X(xs[xs.length - 1])},${Y(yMin)}L${X(xs[0])},${Y(yMin)}Z`}
                                fill={color}
                                opacity={0.08}
                            />
                        )}
                        <path
                            d={d}
                            fill="none"
                            stroke={color}
                            strokeWidth={2}
                            strokeLinejoin="round"
                        />
                        <circle
                            cx={X(pts[pts.length - 1][0])}
                            cy={Y(pts[pts.length - 1][1])}
                            r={3}
                            fill={color}
                        />
                    </g>
                );
            })}
            {cursor !== null && (
                <line
                    x1={X(xs[cursor])}
                    x2={X(xs[cursor])}
                    y1={P.t}
                    y2={h - P.b}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="3 3"
                />
            )}
        </svg>
    );
}

// --- Sparkline row (word trends) -----------------------------------------

export function SparkRow({
    term,
    points,
}: {
    term: string;
    points: [number, number][];
}) {
    const w = 200;
    const h = 36;
    const yMax = Math.max(...points.map((p) => p[1])) || 1;
    const X = (i: number) => 2 + (i / (points.length - 1)) * (w - 4);
    const Y = (v: number) => 3 + (1 - v / yMax) * (h - 6);
    const d = points
        .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`)
        .join("");
    const peak = points.reduce((a, b) => (b[1] > a[1] ? b : a));
    return (
        <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] sm:gap-4 border-b border-border/70 py-2">
            <div className="font-display text-[18px] leading-tight">{term}</div>
            <svg
                viewBox={`0 0 ${w} ${h}`}
                preserveAspectRatio="none"
                className="block h-9 w-full"
                onMouseMove={(ev) => {
                    const rect = (ev.target as SVGElement)
                        .closest("svg")!
                        .getBoundingClientRect();
                    const i = Math.max(
                        0,
                        Math.min(
                            points.length - 1,
                            Math.round(
                                ((ev.clientX - rect.left) / rect.width) * (points.length - 1),
                            ),
                        ),
                    );
                    showTip(
                        ev,
                        `<b>${term}</b><br>${points[i][0]}: ${points[i][1]} per million words`,
                    );
                }}
                onMouseLeave={hideTip}
            >
                <path
                    d={`${d}L${X(points.length - 1)},${h}L${X(0)},${h}Z`}
                    fill="var(--primary)"
                    opacity={0.1}
                />
                <path
                    d={d}
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth={1.6}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
            <div className="w-[4.75rem] text-right text-[13px] leading-tight tabular-nums text-muted-foreground">
                peak {peak[0]}
                <br />
                {peak[1]}/M
            </div>
        </div>
    );
}

// --- Career-span dumbbells ------------------------------------------------

export function SpanChart({
    rows,
    domain,
}: {
    rows: { speaker: string; first: number; last: number; span: number; talks: number }[];
    domain: [number, number];
}) {
    const w = 480;
    const rh = 29;
    const P = { l: 162, r: 54, t: 20, b: 6 };
    const h = P.t + P.b + rows.length * rh;
    const X = (y: number) =>
        P.l + ((y - domain[0]) / (domain[1] - domain[0])) * (w - P.l - P.r);
    const gridYears = [1980, 2000, 2020];
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="block h-auto w-full">
            {gridYears.map((y) => (
                <g key={y}>
                    <line
                        x1={X(y)}
                        x2={X(y)}
                        y1={P.t - 4}
                        y2={h - P.b}
                        stroke="var(--chart-grid)"
                    />
                    <text
                        x={X(y)}
                        y={P.t - 8}
                        textAnchor="middle"
                        className="fill-muted-foreground text-[14px]"
                    >
                        {y}
                    </text>
                </g>
            ))}
            {rows.map((r, i) => {
                const y = P.t + i * rh + rh / 2;
                return (
                    <g
                        key={r.speaker}
                        onMouseMove={(ev) =>
                            showTip(
                                ev,
                                `<b>${r.speaker}</b><br>${r.first} → ${r.last} (${r.span} years, ${r.talks} talks)`,
                            )
                        }
                        onMouseLeave={hideTip}
                    >
                        <rect x={0} y={P.t + i * rh} width={w} height={rh} fill="transparent" />
                        <text
                            x={P.l - 10}
                            y={y + 5}
                            textAnchor="end"
                            className="fill-foreground text-[16px]"
                        >
                            {r.speaker}
                        </text>
                        <line
                            x1={X(r.first)}
                            x2={X(r.last)}
                            y1={y}
                            y2={y}
                            stroke="var(--primary)"
                            strokeWidth={4}
                            strokeLinecap="round"
                            opacity={0.85}
                        />
                        <text
                            x={X(r.last) + 9}
                            y={y + 5}
                            className="fill-muted-foreground text-[14px] tabular-nums"
                        >
                            {r.span} yrs
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// --- Layout ---------------------------------------------------------------

/** Track an element's rendered width (falls back until first measured). */
function useWidth(ref: RefObject<Element | null>, fallback: number) {
    const [w, setW] = useState(fallback);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) =>
            setW(Math.max(260, Math.round(entry.contentRect.width))),
        );
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref]);
    return w;
}

export function BigNumber({
    value,
    label,
    size = "lg",
}: {
    value: string;
    label: string;
    size?: "lg" | "sm";
}) {
    return (
        <div className="min-w-0">
            <div
                className={`font-display font-medium leading-none tabular-nums ${
                    size === "lg" ? "text-[40px] sm:text-[48px]" : "text-[26px] sm:text-[28px]"
                }`}
            >
                {value}
            </div>
            <div className="mt-2 text-[15px] text-muted-foreground">{label}</div>
        </div>
    );
}

/** One chart or list: a hairline rule, a title, a caption, then the content. */
export function Figure({
    title,
    sub,
    children,
    className = "",
}: {
    title: string;
    sub?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <figure className={`min-w-0 border-t border-border pt-5 ${className}`}>
            <h3 className="font-display text-[23px] font-medium leading-snug">{title}</h3>
            {sub && (
                <p className="mt-1 max-w-[62ch] text-[15px] leading-relaxed text-muted-foreground">
                    {sub}
                </p>
            )}
            <div className="mt-5">{children}</div>
        </figure>
    );
}
