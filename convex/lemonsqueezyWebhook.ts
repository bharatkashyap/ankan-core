import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

type SubscriptionEvent = {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      status?: string;
      store_id?: number | string;
      variant_id?: number | string;
      ends_at?: string | null;
      updated_at?: string;
      created_at?: string;
    };
  };
};

async function sign(secret: string, body: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalSignature(expected: string, received: string) {
  if (!/^[a-f\d]{64}$/i.test(received) || expected.length !== received.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ received.toLowerCase().charCodeAt(i);
  }
  return difference === 0;
}

function entitlementStatus(status: string, endsAt: string | null | undefined) {
  if (["active", "on_trial", "past_due"].includes(status)) return "active" as const;
  if (status === "cancelled" && endsAt && Date.parse(endsAt) > Date.now()) return "active" as const;
  if (["cancelled", "expired", "unpaid", "paused"].includes(status)) return "inactive" as const;
  return null;
}

export const webhook = httpAction(async (ctx, request) => {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const signature = request.headers.get("X-Signature");
  if (!secret || !signature) return new Response("Unauthorized", { status: 401 });

  const rawBody = await request.text();
  if (!equalSignature(await sign(secret, rawBody), signature)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: SubscriptionEvent;
  try {
    event = JSON.parse(rawBody) as SubscriptionEvent;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const name = event.meta?.event_name;
  if (!name || ![
    "subscription_created", "subscription_updated", "subscription_cancelled",
    "subscription_expired", "subscription_paused", "subscription_unpaused",
    "subscription_resumed",
  ].includes(name)) return new Response("OK");

  const attributes = event.data?.attributes;
  const userId = event.meta?.custom_data?.user_id;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_PRO_VARIANT_ID;
  if (event.data?.type !== "subscriptions" || !event.data.id ||
      !attributes || typeof userId !== "string" || !userId ||
      !storeId || !variantId || String(attributes.store_id) !== storeId ||
      String(attributes.variant_id) !== variantId ||
      event.meta?.custom_data?.plan_code !== "managed_pro_monthly") {
    return new Response("OK");
  }

  const status = entitlementStatus(attributes.status || "", attributes.ends_at);
  if (!status) return new Response("OK");

  const eventAt = Date.parse(attributes.updated_at || attributes.created_at || "");
  await ctx.runMutation(internal.aiSettings.setManagedEntitlement, {
    userId: userId as any,
    status,
    source: "billing_webhook",
    planCode: "managed_pro_monthly",
    subscriptionId: event.data.id,
    providerEventAt: Number.isFinite(eventAt) ? eventAt : undefined,
  });
  return new Response("OK");
});
