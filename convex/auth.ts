import { convexAuth } from "@convex-dev/auth/server";
import { Email } from "@convex-dev/auth/providers/Email";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { sendOtpEmail } from "./lib/otpEmail";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SignInArgs = {
  provider?: string;
  params?: Record<string, any>;
  verifier?: string;
  refreshToken?: string;
  calledBy?: string;
  turnstileToken?: string;
};

type TurnstileVerifyResponse = {
  success: boolean;
  "error-codes"?: string[];
};

function needsTurnstile(args: SignInArgs) {
  return (
    args.provider === "listmonk-otp" &&
    args.refreshToken === undefined &&
    args.params?.code === undefined
  );
}

async function verifyTurnstile(token: string) {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("[auth] Missing CLOUDFLARE_TURNSTILE_SECRET_KEY");
    throw new Error("Security verification is unavailable");
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error("Security verification failed");
  }

  const verification = (await response.json()) as TurnstileVerifyResponse;
  if (!verification.success) {
    console.warn("[auth] Turnstile rejected challenge", {
      errors: verification["error-codes"] || [],
    });
    throw new Error("Security verification failed");
  }
}

function generateSecureOtpToken() {
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0]!;
  return String(randomValue % 1_000_000).padStart(6, "0");
}

// Keep the provider ID so existing sign-in and verification flows remain compatible.
const AnkanOTP = Email({
  id: "listmonk-otp",
  // Generate 6-digit numeric OTP
  generateVerificationToken: () => generateSecureOtpToken(),
  async sendVerificationRequest({ identifier: email, token }) {
    await sendOtpEmail(email, token);
  },
});

const convexAuthConfig = convexAuth({
  providers: [AnkanOTP],
});

export const { auth, signOut, store } = convexAuthConfig;
const rawSignIn = convexAuthConfig.signIn;

export const signIn = action({
  args: {
    provider: v.optional(v.string()),
    params: v.optional(v.any()),
    verifier: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    calledBy: v.optional(v.string()),
    turnstileToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (needsTurnstile(args) && process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY) {
      if (!args.turnstileToken || !args.turnstileToken.trim()) {
        throw new Error("Security verification required");
      }
      await verifyTurnstile(args.turnstileToken.trim());
    }

    if (!("_handler" in rawSignIn) || typeof rawSignIn._handler !== "function") {
      throw new Error("Auth sign-in handler is unavailable");
    }

    return await rawSignIn._handler(ctx, {
      provider: args.provider,
      params: args.params,
      verifier: args.verifier,
      refreshToken: args.refreshToken,
      calledBy: args.calledBy,
    });
  },
});
