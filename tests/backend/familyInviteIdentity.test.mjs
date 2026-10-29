import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifiedOtpEmail } from "../../convex/lib/verifiedAuthEmail.ts";

const verifiedAccount = {
  provider: "listmonk-otp",
  providerAccountId: "Invitee@Example.com",
  emailVerified: " invitee@example.com ",
};

test("family invite identity requires the verified OTP account email", () => {
  assert.equal(verifiedOtpEmail([verifiedAccount]), "invitee@example.com");
  assert.equal(verifiedOtpEmail([{ ...verifiedAccount, emailVerified: undefined }]), null);
  assert.equal(verifiedOtpEmail([{ ...verifiedAccount, emailVerified: "other@example.com" }]), null);
  assert.equal(verifiedOtpEmail([{ ...verifiedAccount, provider: "untrusted-provider" }]), null);
});

test("family invite acceptance ignores mutable profile email", () => {
  const source = readFileSync(new URL("../../convex/users.ts", import.meta.url), "utf8");
  const accept = source.slice(source.indexOf("export const acceptPendingFamilyInvites"), source.indexOf("// Get user with active profile"));
  const upsert = source.slice(source.indexOf("export const upsert"), source.indexOf("// Get Telegram link status"));

  assert.match(accept, /getVerifiedAuthEmail\(ctx, userId\)/);
  assert.doesNotMatch(accept, /user\.email|providerAccountId/);
  assert.match(upsert, /normalizedEmail !== verifiedEmail/);
});
