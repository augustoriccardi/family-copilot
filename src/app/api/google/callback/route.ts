import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { getAppUrl } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/google/callback?code=xxx&state=memberId
 *
 * Receives the authorization code from Google, exchanges it for tokens,
 * and stores them in CalendarConnection for the family member (state param).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const memberId = searchParams.get("state");
  const appUrl = getAppUrl();

  if (error) {
    return NextResponse.redirect(new URL(`/?google_error=${encodeURIComponent(error)}`, appUrl));
  }

  if (!code || !memberId) {
    return NextResponse.redirect(new URL("/?google_error=missing_params", appUrl));
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/?google_error=server_misconfigured", appUrl));
  }

  const redirectUri = `${appUrl}/api/google/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    console.error("Google token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(new URL("/?google_error=token_exchange_failed", appUrl));
  }

  const tokens = await tokenRes.json();

  // Get the Gmail email to store as providerEmail
  let providerEmail = "unknown";
  try {
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      providerEmail = info.email ?? "unknown";
    }
  } catch {
    // non-fatal
  }

  // Upsert CalendarConnection for this member
  await prisma.calendarConnection.upsert({
    where: {
      // Use a unique constraint on memberId + provider — need to find existing or create
      id:
        (
          await prisma.calendarConnection.findFirst({
            where: { memberId, provider: "google" },
            select: { id: true },
          })
        )?.id ?? "new",
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      providerEmail,
    },
    create: {
      memberId,
      provider: "google",
      providerEmail,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    },
  });

  return NextResponse.redirect(new URL("/?google_connected=1", appUrl));
}
