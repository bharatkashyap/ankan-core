export function entriesInWorkoutSession<T extends { kind: string; profileId: string; sessionId?: string }>(entry: T, candidates: T[]): T[] {
  if (!entry.sessionId) return [entry];
  return candidates.filter((candidate) => candidate.kind === "exercise"
    && candidate.profileId === entry.profileId
    && candidate.sessionId === entry.sessionId);
}

export function entriesInHealthDay<T extends { kind: string; profileId: string; sessionId?: string; date: string }>(
  dayEntries: T[], candidates: T[], profileId: string, kind: "exercise" | "meal", date: string,
): T[] {
  const sessionIds = new Set(dayEntries
    .filter((entry) => entry.profileId === profileId && entry.kind === "exercise" && entry.date === date)
    .map((entry) => entry.sessionId)
    .filter((id): id is string => !!id));
  return candidates.filter((entry) => entry.profileId === profileId && entry.kind === kind
    && (entry.date === date || (kind === "exercise" && !!entry.sessionId && sessionIds.has(entry.sessionId))));
}
