export type MealMacroRow = {
  kind: "meal" | "exercise";
  calories?: number;
  proteinGrams?: number;
  carbsGrams?: number;
  fatGrams?: number;
};

export function sumMealMacros(rows: MealMacroRow[]) {
  const meals = rows.filter((row) => row.kind === "meal");
  const sum = (key: "calories" | "proteinGrams" | "carbsGrams" | "fatGrams") => ({
    amount: meals.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key]! : 0), 0),
    recorded: meals.filter((row) => Number.isFinite(row[key])).length,
  });
  return {
    meals: meals.length,
    calories: sum("calories"),
    protein: sum("proteinGrams"),
    carbs: sum("carbsGrams"),
    fat: sum("fatGrams"),
    incompleteMacros: meals.filter((row) => !Number.isFinite(row.proteinGrams) || !Number.isFinite(row.carbsGrams) || !Number.isFinite(row.fatGrams)).length,
  };
}
