import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmtDay } from "../lib/format";

export interface Series {
  key: string;
  label: string;
  /** CSS color (use a --series-N token). */
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Label shown in the tooltip for this series' date, when it differs from the x-axis (previous period). */
  dates?: string[];
}

interface Props {
  dates: string[];
  series: Series[];
  format: (v: number | null) => string;
  axisFormat?: (v: number) => string;
  height?: number;
  ariaLabel: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

/** "Nice" y-axis ticks (1/2/2.5/5 × 10^n). */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/**
 * Responsive single-axis line chart with a crosshair tooltip.
 * One y-scale only — two measures of different units belong in two charts.
 */
export function TrendChart({ dates, series, format, axisFormat = (v) => format(v), height = 260, ariaLabel }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;

  const { ticks, yMax } = useMemo(() => {
    const max = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v != null && Number.isFinite(v))));
    const t = niceTicks(max);
    return { ticks: t, yMax: t[t.length - 1] || 1 };
  }, [series]);

  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = "";
        let pen = false;
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return void (pen = false);
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
          pen = true;
        });
        return d;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, width, yMax, height]
  );

  const xTickEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 70))));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round((px / rect.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const tooltipLeft = hover != null ? x(hover) : 0;
  const flip = tooltipLeft > width * 0.6;

  return (
    <div className="chart" ref={wrapRef}>
      {series.length > 1 && (
        <ul className="legend" aria-hidden="true">
          {series.map((s) => (
            <li key={s.key}>
              <span className={`swatch${s.dashed ? " dashed" : ""}`} style={{ "--c": s.color } as React.CSSProperties} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {axisFormat(t)}
              </text>
            </g>
          ))}
          {dates.map((d, i) =>
            i % xTickEvery === 0 || (i === n - 1 && (n - 1) % xTickEvery > xTickEvery / 2) ? (
              <text key={d} className="axis" x={x(i)} y={height - 8} textAnchor="middle">
                {fmtDay(d)}
              </text>
            ) : null
          )}
          {series.map((s, si) => (
            <path
              key={s.key}
              d={paths[si]}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "4 4" : undefined}
              opacity={s.dashed ? 0.8 : 1}
            />
          ))}
          {n === 1 &&
            series.map((s) =>
              s.values[0] != null ? <circle key={s.key} cx={x(0)} cy={y(s.values[0]!)} r={4} fill={s.color} /> : null
            )}
          {hover != null && (
            <g pointerEvents="none">
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) => {
                const v = s.values[hover];
                return v != null && Number.isFinite(v) ? (
                  <circle key={s.key} cx={x(hover)} cy={y(v)} r={4.5} fill={s.color} className="dot" />
                ) : null;
              })}
            </g>
          )}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
            style={{ touchAction: "pan-y" }}
          />
        </svg>
      )}
      {hover != null && (
        <div
          className="tooltip"
          style={{
            left: tooltipLeft,
            top: PAD.top + (series.length > 1 ? 28 : 0),
            transform: flip ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <div className="tt-head">{fmtDay(dates[hover], true)}</div>
          {series.map((s) => (
            <div key={s.key} className="tt-row">
              <span className={`swatch${s.dashed ? " dashed" : ""}`} style={{ "--c": s.color } as React.CSSProperties} />
              <span className="tt-label">
                {s.label}
                {s.dates?.[hover] ? ` · ${fmtDay(s.dates[hover])}` : ""}
              </span>
              <strong>{format(s.values[hover] ?? null)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
