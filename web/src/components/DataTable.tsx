import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  label: string;
  num?: boolean;
  hideSm?: boolean;
  sortable?: boolean;
  render: (row: T) => ReactNode;
  footer?: ReactNode;
}

/**
 * Sortable table with a sticky first column that scrolls sideways inside its card on
 * small screens. Sorting itself is the caller's job (server- or client-side).
 */
export function DataTable<T>({ columns, rows, rowKey, sort, dir, onSort, onRowHover, footer = false }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort: string;
  dir: "asc" | "desc";
  onSort: (key: string) => void;
  onRowHover?: (row: T) => void;
  footer?: boolean;
}) {
  const cls = (c: Column<T>, i: number) =>
    [i === 0 && "sticky-col", c.num && "num", c.hideSm && "hide-sm"].filter(Boolean).join(" ");
  return (
    <div className="table-wrap">
      <table className="table campaigns">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c.key} className={cls(c, i)}
                aria-sort={c.sortable === false ? undefined : sort === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                {c.sortable === false ? c.label : (
                  <button className="th-btn" onClick={() => onSort(c.key)}>
                    {c.label}{sort === c.key && <span aria-hidden="true">{dir === "asc" ? " ↑" : " ↓"}</span>}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} onMouseEnter={onRowHover ? () => onRowHover(r) : undefined}>
              {columns.map((c, i) => <td key={c.key} className={cls(c, i)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr>{columns.map((c, i) => <td key={c.key} className={cls(c, i)}>{c.footer ?? ""}</td>)}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Toggle helper: same column flips direction; a new column starts descending (text ascending). */
export function nextSort(current: string, dir: "asc" | "desc", key: string, textKeys: string[] = []): { sort: string; dir: "asc" | "desc" } {
  if (current === key) return { sort: key, dir: dir === "desc" ? "asc" : "desc" };
  return { sort: key, dir: textKeys.includes(key) ? "asc" : "desc" };
}
