import { z } from "zod";
import { insertWebhookEndpoint, listWebhookEndpoints } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import { requireAdmin, requireContext } from "@/lib/rbac";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const CreateSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

/** Customer-configured webhook endpoints (used by Zapier/Make + direct integrations). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = requireContext(request, id);
    requireAdmin(ctx);
    return json({ endpoints: listWebhookEndpoints(id), available_events: WEBHOOK_EVENTS });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = CreateSchema.parse(await request.json());
    const ctx = requireContext(request, id);
    requireAdmin(ctx);

    const { newWebhookSecret } = await import("@/lib/webhooks");
    const endpoint = insertWebhookEndpoint({
      workspace_id: id,
      url: body.url,
      secret: newWebhookSecret(),
      events: body.events as unknown as string[],
    });
    // The signing secret is returned exactly once.
    return json({ endpoint, secret: endpoint.secret }, 201);
  } catch (err) {
    return apiError(err);
  }
}
