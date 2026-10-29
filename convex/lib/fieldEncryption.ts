// Ankan Core stores values plainly in its local Convex database. These helpers
// retain the existing document shape without requiring an encryption key.
export type SalaryDetailsNumeric = {
  baseAmount?: number;
  bonusAmount?: number;
  allowanceAmount?: number;
  reimbursementAmount?: number;
  otherTaxableBenefitsAmount?: number;
  socialSecurityEmployeeAmount?: number;
  taxWithheldAmount?: number;
};

export type EncryptedSalaryDetails = {
  baseAmountEnc?: string;
  bonusAmountEnc?: string;
  allowanceAmountEnc?: string;
  reimbursementAmountEnc?: string;
  otherTaxableBenefitsAmountEnc?: string;
  socialSecurityEmployeeAmountEnc?: string;
  taxWithheldAmountEnc?: string;
};

export async function encryptNumber(value: number): Promise<string> {
  if (!Number.isFinite(value)) throw new Error("Invalid numeric value");
  return String(value);
}

export async function decryptNumber(value: string): Promise<number> {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Invalid stored numeric value");
  return number;
}

export async function encryptOptionalNumber(value: number | undefined): Promise<string | undefined> {
  return value === undefined ? undefined : encryptNumber(value);
}

export async function encryptOptionalString(value: string | undefined): Promise<string | undefined> {
  return value?.trim() || undefined;
}

export async function decryptString(value: string): Promise<string> {
  return value;
}

export async function decryptStringWithFallback(value: string | undefined, plain: string | undefined): Promise<string | undefined> {
  return value ?? plain;
}

export async function decryptNumberWithFallback(value: string | undefined, plain: number | undefined, fieldLabel: string): Promise<number> {
  if (value !== undefined) return decryptNumber(value);
  if (typeof plain === "number" && Number.isFinite(plain)) return plain;
  throw new Error(`Missing numeric value for ${fieldLabel}`);
}

export async function encryptSalaryDetails(details: SalaryDetailsNumeric | undefined): Promise<EncryptedSalaryDetails | undefined> {
  if (!details) return undefined;
  return Object.fromEntries(Object.entries(details).map(([key, value]) => [`${key}Enc`, value === undefined ? undefined : String(value)])) as EncryptedSalaryDetails;
}

export async function decryptSalaryDetailsWithFallback(stored: EncryptedSalaryDetails | undefined, plain: SalaryDetailsNumeric | undefined): Promise<SalaryDetailsNumeric | undefined> {
  if (!stored && !plain) return undefined;
  const result: Record<string, number | undefined> = { ...plain };
  for (const [key, value] of Object.entries(stored || {})) {
    if (key.endsWith("Enc") && value !== undefined) result[key.slice(0, -3)] = await decryptNumber(value);
  }
  return result as SalaryDetailsNumeric;
}

export async function encryptSecretString(value: string): Promise<string> {
  if (!value.trim()) throw new Error("Secret cannot be empty");
  return value.trim();
}

export async function decryptSecretString(value: string): Promise<string> {
  if (!value.trim()) throw new Error("Secret cannot be empty");
  return value.trim();
}
