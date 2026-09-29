import { useSyncExternalStore } from "react";
import type { Range } from "./types";

type Params = URLSearchParams | Record<string, string> | Range;

/**
 * Hash router (#/campaigns?from=…&to=…). No server config needed, links are
 * shareable, and the date range lives in the URL so a refresh keeps your view.
 */
export interface Route {
  path: string;
  params: URLSearchParams;
}

const read = () => location.hash.slice(1) || "/";
let snapshot = read();
let parsed: Route = parse(snapshot);

function parse(h: string): Route {
  const [path, query = ""] = h.split("?");
  return { path: path || "/", params: new URLSearchParams(query) };
}

function subscribe(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => {
    const h = read();
    if (h !== snapshot) {
      snapshot = h;
      parsed = parse(h);
    }
    return parsed;
  });
}

export function href(path: string, params?: Params): string {
  const q = params ? new URLSearchParams(params as Record<string, string>).toString() : "";
  return `#${path}${q ? `?${q}` : ""}`;
}

export function navigate(path: string, params?: Params, replace = false): void {
  const target = href(path, params);
  if (replace) history.replaceState(null, "", target);
  else location.hash = target.slice(1);
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}
