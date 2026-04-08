"use client";
import { ReactNode, useCallback, useEffect, useState } from "react";
import { ThreadList } from "./ThreadList";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { MCPServerList } from "./MCPServerList";
import { WatchedSourceList } from "./WatchedSourceList";

interface MainLayoutProps {
  children: ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
  // Start open on desktop (md+), closed on mobile
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setSidebarOpen(true);
    }
  }, []);
  const [showMCPConfig, setShowMCPConfig] = useState(false);
  const [showWatchedSources, setShowWatchedSources] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const openMCPConfig = useCallback(() => setShowMCPConfig(true), []);
  const closeMCPConfig = useCallback(() => setShowMCPConfig(false), []);
  const openWatchedSources = useCallback(() => setShowWatchedSources(true), []);
  const closeWatchedSources = useCallback(() => setShowWatchedSources(false), []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <Sidebar isOpen={isSidebarOpen} toggle={toggleSidebar}>
        <ThreadList onOpenMCPConfig={openMCPConfig} onOpenWatchedSources={openWatchedSources} />
      </Sidebar>

      {/* Main content area */}
      <div className="bg-gray-150 flex min-w-0 flex-1 flex-col">
        <div className="z-10">
          <Header toggleSidebar={toggleSidebar} />
        </div>

        {/* Main content */}
        <div className="relative h-[calc(100vh-4rem)] flex-1">{children}</div>
      </div>

      {/* MCP Configuration Modal */}
      <MCPServerList isOpen={showMCPConfig} onClose={closeMCPConfig} />

      {/* Watched Sources Modal */}
      <WatchedSourceList isOpen={showWatchedSources} onClose={closeWatchedSources} />
    </div>
  );
}
