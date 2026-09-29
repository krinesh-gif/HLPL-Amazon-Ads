import { href } from "../lib/router";
import type { Range } from "../lib/types";

export const SETUP_LINKS = [
  { path: "/setup/products", label: "Product catalogue" },
  { path: "/setup/sb-mapper", label: "SB campaign mapper" },
  { path: "/setup/import", label: "Data import" },
  { path: "/sync", label: "Sync status" },
];

/** Sub-navigation shown on Setup screens (the sidebar has them too; this is for phones). */
export function SetupNav({ current, range }: { current: string; range: Range }) {
  return (
    <nav className="seg setup-nav" aria-label="Setup">
      {SETUP_LINKS.map((l) => (
        <a key={l.path} href={href(l.path, range)} className={current === l.path ? "active" : ""} aria-current={current === l.path ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
