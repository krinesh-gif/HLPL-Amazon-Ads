import { useMemo } from "react";
import { send, useApi } from "./api";
import type { Change, ChangesResponse, StageResult } from "./types";

/** The staged queue, indexed by entity key so any row can show "staged" state. */
export function useQueue() {
  const { data, error } = useApi<ChangesResponse>("/api/changes");
  const byKey = useMemo(() => new Map((data?.changes ?? []).map((c) => [c.entityKey, c] as const)), [data]);
  /** Harvest keys include the destination ad group; look a search term up by term alone. */
  const harvestByTerm = useMemo(
    () => new Map((data?.changes ?? []).filter((c) => c.kind === "harvest").map((c) => [c.label, c] as const)),
    [data]
  );
  return { data, error, byKey, harvestByTerm, count: data?.changes.length ?? 0 };
}

export type StageRequest =
  | { kind: "bid"; targetId: string; bid: number; reason?: string }
  | { kind: "state"; targetId: string; state: "enabled" | "paused"; reason?: string }
  | { kind: "negative"; searchTerm: string; campaignId: string; adGroupId: string; reason?: string }
  | { kind: "harvest"; searchTerm: string; campaignId: string; adGroupId: string; bid: number; reason?: string };

/** Stages one or more changes. Never touches Amazon — that only happens from the Deploy queue. */
export async function stage(changes: StageRequest[]): Promise<StageResult> {
  return send<StageResult>("POST", "/api/changes", { changes });
}

export function unstage(c: Pick<Change, "id">): Promise<unknown> {
  return send("DELETE", `/api/changes/${c.id}`);
}
