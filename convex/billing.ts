import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";
const PRO_PLAN_CODE = "managed_pro_monthly";

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ConvexError(
      `Billing is not configured (${name} missing). Please contact support.`,
    );
  }
  return value;
}

function getAppPublicUrl() {
  const raw =
    process.env.APP_PUBLIC_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export const createManagedCheckout = action({
  args: {
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError("Unauthorized: Please log in");
    }

    const currentUser = await ctx.runQuery(api.users.currentUser, {});
    if (!currentUser) {
      throw new ConvexError("Unauthorized: User not found");
    }

    const settings = await ctx.runQuery(api.aiSettings.getMySettings, {});
    if (settings.managedPlanTier === "PAID") {
      throw new ConvexError("You already have a subscription. Manage it in Usage & Billing.");
    }

    const apiKey = getRequiredEnv("LEMONSQUEEZY_API_KEY");
    const storeId = getRequiredEnv("LEMONSQUEEZY_STORE_ID");
    const variantId = getRequiredEnv("LEMONSQUEEZY_PRO_VARIANT_ID");
    const appUrl = getAppPublicUrl();

    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: currentUser.email || undefined,
            custom: {
              user_id: String(userId),
              plan_code: PRO_PLAN_CODE,
              source: args.source || "app",
            },
          },
          checkout_options: {
            embed: false,
            media: true,
            logo: true,
            desc: true,
          },
          product_options: {
            enabled_variants: [Number(variantId)],
            redirect_url: `${appUrl}/usage?checkout=success`,
            receipt_button_text: "Open Ankan",
            receipt_link_url: `${appUrl}/usage`,
          },
        },
        relationships: {
          store: {
            data: {
              type: "stores",
              id: String(storeId),
            },
          },
          variant: {
            data: {
              type: "variants",
              id: String(variantId),
            },
          },
        },
      },
    };

    const response = await fetch(`${LEMON_API_BASE}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const details = await response.text();
      console.error("[billing] Failed to create LemonSqueezy checkout", {
        status: response.status,
        details,
      });
      throw new ConvexError("Could not start checkout. Please try again.");
    }

    const body = (await response.json()) as any;
    const checkoutUrl: string | undefined =
      body?.data?.attributes?.url ||
      body?.data?.attributes?.checkout_url ||
      body?.meta?.url;

    if (!checkoutUrl) {
      console.error("[billing] Missing checkout URL in LemonSqueezy response", body);
      throw new ConvexError("Could not start checkout. Please try again.");
    }

    return {
      url: checkoutUrl,
      checkoutId: String(body?.data?.id || ""),
    };
  },
});

export const openBillingPortal = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Unauthorized: Please log in");
    const subscriptionId = await ctx.runQuery(internal.aiSettings.getBillingSubscription, { userId });
    if (!subscriptionId) throw new ConvexError("No subscription found for this account");
    const apiKey = getRequiredEnv("LEMONSQUEEZY_API_KEY");
    const response = await fetch(`${LEMON_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/vnd.api+json" },
    });
    if (!response.ok) {
      console.error("[billing] Failed to retrieve subscription", response.status);
      throw new ConvexError("Could not open billing portal. Please try again.");
    }
    const body = await response.json();
    const url = body?.data?.attributes?.urls?.customer_portal;
    if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new ConvexError("Could not open billing portal. Please try again.");
    }
    return { url };
  },
});
