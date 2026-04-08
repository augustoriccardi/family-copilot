import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/config/app-url";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/**
 * GET /api/google/connect
 *
 * Generates a Google OAuth URL tied to the session user.
 * The state param carries the userId so the callback re-associates the
 * tokens with the correct User (and their linked FamilyMember, if any).
 *
 * Falls back to ?memberId=xxx for backward compatibility.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const { searchParams } = new URL(request.url);

  // Prefer session userId; fall back to explicit memberId param
  const state = session?.user?.id ?? searchParams.get("memberId");

  if (!state) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { GOOGLE_CLIENT_ID } = process.env;
  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID not configured" }, { status: 500 });
  }

  const appUrl = getAppUrl();
  const redirectUri = `${appUrl}/api/google/callback`;

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
