import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible auth config — no Prisma, no Node.js-only imports.
 * Used by middleware.ts and spread into src/auth.ts.
 */
export default {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    newUser: "/register",
    error: "/login",
  },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
      }
      if (!token.id && token.sub) token.id = token.sub;
      return token;
    },
    async session({ session, token }) {
      session.user.id = (token.id ?? token.sub) as string;
      if (token.image) session.user.image = token.image as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
