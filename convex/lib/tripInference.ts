type DatedNote = { date: string; note: string };

const day = 86400000;
const atUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (time: number) => new Date(time).toISOString().slice(0, 10);

export function tripDateWindow(place: string, rows: DatedNote[]) {
  const anchors = rows
    .filter((row) => row.note.toLocaleLowerCase().includes(place.toLocaleLowerCase()))
    .map((row) => atUtc(row.date))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!anchors.length) return null;
  const clusters: number[][] = [];
  for (const date of anchors) {
    const last = clusters.at(-1);
    if (last?.length && date - last[last.length - 1]! <= 10 * day) last.push(date);
    else clusters.push([date]);
  }
  clusters.sort((a, b) => b.length - a.length || b[b.length - 1]! - a[a.length - 1]!);
  const chosen = clusters[0]!;
  const padding = chosen.length === 1 ? 5 : 4;
  return {
    startDate: iso(chosen[0]! - padding * day),
    endDate: iso(chosen[chosen.length - 1]! + (padding + 1) * day),
    anchorDates: chosen.map(iso),
  };
}

export function candidatesInWindow<T extends DatedNote>(rows: T[], window: ReturnType<typeof tripDateWindow>) {
  return window ? rows.filter((row) => row.date >= window.startDate && row.date < window.endDate) : rows;
}
