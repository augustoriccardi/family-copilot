"use client";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const PUBLIC_PATHS = ["/login", "/register", "/invite"];
const ONBOARDING_PATH = "/onboarding";
const SETUP_PATH = "/onboarding/setup";
const ONBOARDING_PATHS = [ONBOARDING_PATH, SETUP_PATH];

type CheckState = "pending" | "ready";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // Block render until we know whether to redirect or show the page
  const [checkState, setCheckState] = useState<CheckState>("pending");

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    // Public pages and onboarding pages never need the guard check
    if (isPublic || ONBOARDING_PATHS.some((p) => pathname.startsWith(p))) {
      setCheckState("ready");
      return;
    }

    if (status === "loading") return;

    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
      // Keep pending — we're about to navigate away
      return;
    }

    // status === "authenticated": check member/household
    fetch("/api/auth/linked-member")
      .then((r) => r.json())
      .then((data: { member: unknown; householdExists: boolean }) => {
        const hasLinkedMember = !!data.member;
        const householdExists = data.householdExists;

        if (!hasLinkedMember) {
          router.replace(householdExists ? ONBOARDING_PATH : SETUP_PATH);
          // Keep pending — navigating away
          return;
        }

        // User is fully set up
        setCheckState("ready");
      })
      .catch(() => {
        // On error, let the page render so the user isn't stuck
        setCheckState("ready");
      });
  }, [status, pathname, router, isPublic]);

  if (checkState === "pending") return null;
  return <>{children}</>;
}
