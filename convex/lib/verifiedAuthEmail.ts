import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

type AuthAccountEmail = {
  provider: string;
  providerAccountId: string;
  emailVerified?: string;
};

export function verifiedOtpEmail(accounts: AuthAccountEmail[]): string | null {
  for (const account of accounts) {
    if (account.provider !== "listmonk-otp" || !account.emailVerified) continue;
    const verified = account.emailVerified.toLowerCase().trim();
    if (verified && verified === account.providerAccountId.toLowerCase().trim()) {
      return verified;
    }
  }
  return null;
}

export async function getVerifiedAuthEmail(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) =>
      q.eq("userId", userId).eq("provider", "listmonk-otp"),
    )
    .collect();
  return verifiedOtpEmail(accounts);
}
