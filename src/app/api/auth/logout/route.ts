import { NextResponse } from "next/server";
import { deleteSession } from "@/lib/db";
import { SESSION_COOKIE, parseCookies } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = parseCookies(request.headers.get("cookie") ?? "")[SESSION_COOKIE];
  if (token) deleteSession(token);
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
  return res;
}
