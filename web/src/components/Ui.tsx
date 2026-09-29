import type { ReactNode } from "react";
import { fmtChange } from "../lib/format";
import type { MetricDef } from "../lib/metrics";

export function Card({ title, subtitle, actions, children, className = "" }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Period-over-period change. Arrow + sign carry direction; color only adds good/bad. */
export function Delta({ value, metric }: { value: number | null; metric: Pick<MetricDef, "lowerIsBetter" | "neutral"> }) {
  if (value == null || !Number.isFinite(value)) return <span className="delta">—</span>;
  const up = value > 0;
  const flat = Math.abs(value) < 0.005;
  const good = metric.neutral || flat ? "neutral" : up !== !!metric.lowerIsBetter ? "good" : "bad";
  return (
    <span className={`delta ${good}`}>
      <span aria-hidden="true">{flat ? "→" : up ? "↑" : "↓"}</span> {fmtChange(value)}
    </span>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="card error-box" role="alert">
      <strong>Couldn't load this view.</strong> <span className="muted">{message}</span>
    </div>
  );
}

export function StatePill({ state }: { state: string | null }) {
  if (!state) return <span className="pill">unknown</span>;
  return <span className={`pill state-${state}`}>{state}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}
