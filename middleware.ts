import NextAuth from "next-auth";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth?.user;
  const isOnLoginPage = req.nextUrl.pathname.startsWith("/login");
  const isOnRegisterPage = req.nextUrl.pathname.startsWith("/register");
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth");

  // Allow auth routes
  if (isAuthRoute) {
    return;
  }

  // Redirect logged-in users away from login/register pages
  if (isLoggedIn && (isOnLoginPage || isOnRegisterPage)) {
    return Response.redirect(new URL("/", req.url));
  }

  console.log(
    "[middleware] isLoggedIn:",
    isLoggedIn,
    "isOnLoginPage:",
    isOnLoginPage,
    "isOnRegisterPage:",
    isOnRegisterPage,
  );

  // Redirect unauthenticated users to login
  if (!isLoggedIn && !isOnLoginPage && !isOnRegisterPage) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  return;
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
