type ClassValue =
  | string
  | number
  | undefined
  | null
  | boolean
  | Record<string, any>
  | Array<ClassValue>;

function toClassString(input: ClassValue): string {
  if (!input) return "";
  if (typeof input === "string" || typeof input === "number")
    return String(input);
  if (Array.isArray(input))
    return input.map(toClassString).filter(Boolean).join(" ");
  if (typeof input === "object") {
    return Object.entries(input)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(" ");
  }
  return "";
}

export function cn(...inputs: ClassValue[]) {
  return inputs.map(toClassString).filter(Boolean).join(" ");
}

export default cn;
