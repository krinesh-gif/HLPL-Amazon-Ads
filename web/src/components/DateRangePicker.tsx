import { useEffect, useRef, useState } from "react";
import { PRESETS, matchPreset, presetRange } from "../lib/dates";
import { fmtRange } from "../lib/format";
import type { Range } from "../lib/types";

export function DateRangePicker({ range, anchor, minDate, onChange }: {
  range: Range;
  anchor: string;
  minDate: string | null;
  onChange: (r: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(range);
  const ref = useRef<HTMLDivElement>(null);
  const preset = matchPreset(range, anchor);

  useEffect(() => setDraft(range), [range.from, range.to]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const label = preset === "custom" ? fmtRange(range.from, range.to) : PRESETS.find((p) => p.key === preset)!.label;

  return (
    <div className="daterange" ref={ref}>
      <button className="btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/></svg>
        <span className="daterange-label">{label}</span>
        <span className="muted small hide-sm">{preset !== "custom" && fmtRange(range.from, range.to)}</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Choose date range">
          <div className="preset-list">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                className={`preset${preset === p.key ? " active" : ""}`}
                onClick={() => {
                  onChange(presetRange(p.key, anchor));
                  setOpen(false);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <form
            className="custom-range"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.from && draft.to && draft.from <= draft.to) {
                onChange(draft);
                setOpen(false);
              }
            }}
          >
            <label>
              From
              <input type="date" value={draft.from} min={minDate ?? undefined} max={draft.to}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </label>
            <label>
              To
              <input type="date" value={draft.to} min={draft.from} max={anchor}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
            <button className="btn primary" type="submit">Apply</button>
          </form>
          <p className="muted small">Compared with the same number of days immediately before.</p>
        </div>
      )}
    </div>
  );
}
