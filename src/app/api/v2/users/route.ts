import { listUsers } from "@/lib/db";
import { apiError, json } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local/demo identity directory backing the user switcher. In production this
 * is replaced by the SSO provider's directory (Enterprise tier); role checks
 * remain server-side either way.
 */
export async function GET() {
  try {
    return json({ users: await listUsers() });
  } catch (err) {
    return apiError(err);
  }
}
