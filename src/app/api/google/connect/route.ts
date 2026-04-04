import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/**
 * GET /api/google/connect?memberId=xxx
 *
 * Generates a Google OAuth URL for the given family member.
 * The memberId is passed as OAuth state so the callback can associate
 * the tokens with the correct FamilyMember.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get("memberId");

  if (!memberId) {
    return NextResponse.json({ error: "memberId is required" }, { status: 400 });
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
    state: memberId,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
