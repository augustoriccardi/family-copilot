"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MainLayout } from "@/components/MainLayout";
import { useThreads } from "@/hooks/useThreads";
import { Thread } from "@/components/Thread";

export default function Home() {
  const { status } = useSession();
  const { threads, isLoadingThreads, createThread } = useThreads();
  const router = useRouter();
  const [rootThreadId, setRootThreadId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || isLoadingThreads) return;
    if (threads.length > 0) {
      setRootThreadId(threads[0].id);
    } else {
      (async () => {
        const t = await createThread();
        setRootThreadId(t.id);
      })();
    }
  }, [status, isLoadingThreads, threads, createThread]);

  return (
    <MainLayout>
      {rootThreadId && (
        <Thread
          threadId={rootThreadId}
          onFirstMessageSent={(id) => router.replace(`/thread/${id}`)}
        />
      )}
    </MainLayout>
  );
}
