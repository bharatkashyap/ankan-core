import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Telegram Webhook Handler
 *
 * Receives updates from Telegram Bot API and routes them to appropriate handlers.
 * Webhook must be registered with Telegram using:
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=<CONVEX_SITE_URL>/telegram/webhook
 */
export const webhook = httpAction(async (ctx, request) => {
  // Reject requests without the webhook secret before parsing or dispatching updates.
  const secretToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET is not configured");
    return new Response("Unauthorized", { status: 401 });
  }

  if (secretToken !== expectedSecret) {
    console.error("[telegram] Invalid webhook secret");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const update = await request.json();
    if (update.callback_query?.data?.startsWith("trip:")) {
      const callback = update.callback_query;
      await ctx.runAction((internal as any).tripReportActions.handleApprovalCallback, {
        callbackId: String(callback.id),
        chatId: String(callback.message?.chat?.id || ""),
        fromId: String(callback.from?.id || ""),
        messageId: Number(callback.message?.message_id || 0),
        data: String(callback.data),
      });
      return new Response("OK", { status: 200 });
    }
    const message = update.message;
    console.info("[telegram] Received update", {
      updateId: update.update_id,
      payloadType: message ? "message" : "unsupported",
      messageId: message?.message_id,
      chatType: message?.chat?.type,
      hasText: typeof message?.text === "string",
      hasCaption: typeof message?.caption === "string",
      hasPhoto: Array.isArray(message?.photo) && message.photo.length > 0,
      hasDocument: Boolean(message?.document),
      documentMimeType: message?.document?.mime_type,
    });

    // Handle message updates
    if (update.message) {
      // A group chat ID belongs to the group, not to the sender. Never link or
      // process personal records from a shared chat.
      if (message.chat?.type !== "private" || String(message.chat?.id) !== String(message.from?.id)) {
        return new Response("OK", { status: 200 });
      }
      const chatId = String(message.chat.id);
      const text = message.text || message.caption || "";
      const from = message.from;

      // Extract photo file_id (Telegram sends multiple sizes, pick the largest)
      let photoFileId: string | undefined;
      if (Array.isArray(message.photo) && message.photo.length > 0) {
        photoFileId = message.photo[message.photo.length - 1].file_id;
      }

      // Extract document file_id (PDFs, etc)
      let documentFileId: string | undefined;
      let documentMimeType: string | undefined;
      if (message.document) {
        documentFileId = message.document.file_id;
        documentMimeType = message.document.mime_type;
      }

      // Route to internal action for processing
      await ctx.runAction(internal.telegramBot.handleMessage, {
        receivedAt: Date.now(),
        chatId,
        text,
        fromId: String(from?.id || ""),
        fromUsername: from?.username || "",
        fromFirstName: from?.first_name || "",
        photoFileId,
        documentFileId,
        documentMimeType,
        messageId: String(message.message_id),
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[telegram] Webhook error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
