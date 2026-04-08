import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/database/prisma";
import { getAppUrl } from "@/lib/config/app-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/google/callback?code=xxx&state=<userId|memberId>
 *
 * Handles Google OAuth callback. The `state` param can be:
 *   - A User.id (cuid, sent by /api/google/connect when user is authenticated)
 *   - A FamilyMember.id (legacy — sent by the old manual connect flow)
 *
 * In both cases we upsert a CalendarConnection and link it to as many
 * identifiers as possible (userId + memberId).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");
  const appUrl = getAppUrl();

  if (error) {
    return NextResponse.redirect(new URL(`/?google_error=${encodeURIComponent(error)}`, appUrl));
  }

  if (!code || !state) {
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

  const tokenData = {
    accessToken: tokens.access_token as string,
    refreshToken: (tokens.refresh_token as string | undefined) ?? null,
    expiresAt: tokens.expires_in
      ? new Date(Date.now() + (tokens.expires_in as number) * 1000)
      : null,
    providerEmail,
  };

  // Resolve whether `state` is a userId or memberId
  const user = await prisma.user.findUnique({ where: { id: state }, select: { id: true } });

  if (user) {
    // state = userId — new flow
    const linkedMember = await prisma.familyMember.findFirst({
      where: { linkedUserId: user.id },
      select: { id: true },
    });
    const existing = await prisma.calendarConnection.findFirst({
      where: { userId: user.id, provider: "google" },
      select: { id: true },
    });
    if (existing) {
      await prisma.calendarConnection.update({
        where: { id: existing.id },
        data: { ...tokenData, ...(linkedMember ? { memberId: linkedMember.id } : {}) },
      });
    } else {
      await prisma.calendarConnection.create({
        data: {
          userId: user.id,
          provider: "google",
          ...tokenData,
          memberId: linkedMember?.id ?? null,
        },
      });
    }
  } else {
    // state = memberId — legacy flow
    const memberId = state;
    const existing = await prisma.calendarConnection.findFirst({
      where: { memberId, provider: "google" },
      select: { id: true },
    });
    if (existing) {
      await prisma.calendarConnection.update({ where: { id: existing.id }, data: tokenData });
    } else {
      await prisma.calendarConnection.create({
        data: { memberId, provider: "google", ...tokenData },
      });
    }
  }

  return NextResponse.redirect(new URL("/?google_connected=1", appUrl));
}
