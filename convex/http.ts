// convex/http.ts
// HTTP endpoints on the .convex.site domain. Currently: the Clerk user
// webhook (svix-signed). Razorpay's payment webhook joins in Phase C.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Webhook } from "svix";
import { env } from "./lib/env";

const http = httpRouter();

interface ClerkUserPayload {
  id?: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string;
  first_name?: string | null;
  last_name?: string | null;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserPayload;
}

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = env("CLERK_WEBHOOK_SECRET");
    if (!secret) {
      console.error("CLERK_WEBHOOK_SECRET is not configured");
      return new Response("webhook secret not configured", { status: 500 });
    }
    // svix verifies over the raw body — read it before any parsing.
    const payload = await request.text();
    const headers = {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    };
    let event: ClerkWebhookEvent;
    try {
      event = new Webhook(secret).verify(payload, headers) as ClerkWebhookEvent;
    } catch {
      return new Response("invalid signature", { status: 400 });
    }

    const clerkUserId = event.data.id;
    if (!clerkUserId) return new Response("missing user id", { status: 400 });

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        const primary = event.data.email_addresses?.find(
          (e) => e.id === event.data.primary_email_address_id,
        ) ?? event.data.email_addresses?.[0];
        const name = [event.data.first_name, event.data.last_name]
          .filter(Boolean)
          .join(" ");
        await ctx.runMutation(internal.users.upsertFromClerk, {
          clerkUserId,
          ...(primary?.email_address ? { email: primary.email_address } : {}),
          ...(name ? { name } : {}),
        });
        break;
      }
      case "user.deleted":
        await ctx.runMutation(internal.users.markDeleted, { clerkUserId });
        break;
      default:
        // Unknown event types are fine — acknowledge so Clerk stops retrying.
        break;
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
