import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcryptjs from "bcryptjs";
import prisma from "@/lib/database/prisma";
import authConfig from "../auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    /**
     * Google OAuth — signs in AND registers CalendarConnection automatically.
     */
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/gmail.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),

    /**
     * Email + password credentials login.
     */
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          select: { id: true, email: true, name: true, image: true, password: true },
        });
        if (!user?.password) return null;
        const valid = await bcryptjs.compare(credentials.password as string, user.password);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      // On initial sign-in: user + account are present, user is already in DB
      if (user) {
        token.id = user.id;
        token.image = user.image;

        // Sync CalendarConnection here — user row is guaranteed to exist at this point
        if (account?.provider === "google" && user.id && account.access_token) {
          try {
            const existing = await prisma.calendarConnection.findFirst({
              where: { providerEmail: user.email!, provider: "google" },
              select: { id: true },
            });
            await prisma.calendarConnection.upsert({
              where: { id: existing?.id ?? "new" },
              create: {
                userId: user.id,
                provider: "google",
                providerEmail: user.email!,
                accessToken: account.access_token,
                refreshToken: account.refresh_token ?? null,
                expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
              },
              update: {
                userId: user.id,
                accessToken: account.access_token,
                refreshToken: account.refresh_token ?? null,
                expiresAt: account.expires_at ? new Date(account.expires_at * 1000) : null,
              },
            });
          } catch (e) {
            console.error("[auth] CalendarConnection sync failed:", e);
          }
        }

        return token;
      }
      if (!token.id && token.sub) token.id = token.sub;
      // On subsequent requests, verify the user still exists in DB
      if (token.id) {
        const exists = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { id: true },
        });
        if (!exists) return null as any; // Invalidate token → clears cookie
      }
      return token;
    },
    async signIn() {
      return true;
    },
  },
});
