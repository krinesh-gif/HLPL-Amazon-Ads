import { useState } from "react";

/** Per-browser conveniences (theme, target ACOS). Storage can be unavailable — always fall back. */
export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`aravi.${key}`);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`aravi.${key}`, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  };
  return [value, set];
}
