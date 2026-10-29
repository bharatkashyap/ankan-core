export type WeightGroup = { sets: number; weight: number };

const countWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// Capture only explicit set-count/weight pairs. The model still identifies exercises;
// this preserves multiple weights from a clear text instruction without changing its prompt.
export function explicitWeightGroups(text: string, exercise: string, exerciseNames: string[]): WeightGroup[] | undefined {
  const lower = text.toLowerCase();
  const start = lower.indexOf(exercise.toLowerCase());
  if (start < 0 && exerciseNames.length !== 1) return undefined;
  const afterName = start < 0 ? 0 : start + exercise.length;
  const nextExercise = exerciseNames
    .filter((name) => name.toLowerCase() !== exercise.toLowerCase())
    .map((name) => lower.indexOf(name.toLowerCase(), afterName))
    .filter((index) => index >= 0);
  const segment = text.slice(afterName, nextExercise.length ? Math.min(...nextExercise) : undefined);
  const pattern = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:sets?\s*)?(?:at|@|of|with|x)\s*(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilograms?)?\b/gi;
  const matches = [...segment.matchAll(pattern)];
  const groups = matches.map((match) => ({
    sets: countWords[match[1].toLowerCase()] ?? Number(match[1]),
    weight: Number(match[2]),
  })).filter(({ sets, weight }) => Number.isSafeInteger(sets) && sets > 0 && Number.isFinite(weight) && weight >= 0);
  return groups.length > 1 ? groups : undefined;
}
