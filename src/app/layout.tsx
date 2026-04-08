"use client";
import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import "./globals.css";
import { ThreadProvider } from "@/contexts/ThreadContext";
import { UISettingsProvider } from "@/contexts/UISettingsContext";
import { OAuthToast } from "@/components/OAuthToast";
import { AuthGuard } from "@/components/AuthGuard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
    },
  },
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Family Copilot</title>
      </head>
      <body>
        <SessionProvider>
          <QueryClientProvider client={queryClient}>
            <UISettingsProvider>
              <ThreadProvider>
                <AuthGuard>
                  <Suspense fallback={null}>
                    <OAuthToast />
                  </Suspense>
                  {children}
                </AuthGuard>
              </ThreadProvider>
            </UISettingsProvider>
          </QueryClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
