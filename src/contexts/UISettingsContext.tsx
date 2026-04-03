"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface CallerIdentity {
  callerId: string;
  callerName: string;
  callerRole: string;
  callerColor?: string | null;
}

interface UISettingsContextType {
  hideToolMessages: boolean;
  toggleToolMessages: () => void;
  caller: CallerIdentity | null;
  setCaller: (caller: CallerIdentity | null) => void;
  approveAllTools: boolean;
  setApproveAllTools: (value: boolean) => void;
}

const UISettingsContext = createContext<UISettingsContextType | undefined>(undefined);

const CALLER_STORAGE_KEY = "family_copilot_caller";

interface UISettingsProviderProps {
  children: ReactNode;
}

export const UISettingsProvider = ({ children }: UISettingsProviderProps) => {
  const [hideToolMessages, setHideToolMessages] = useState(true);
  const [caller, setCallerState] = useState<CallerIdentity | null>(null);
  const [approveAllTools, setApproveAllTools] = useState(true);

  // Load caller from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CALLER_STORAGE_KEY);
      if (stored) setCallerState(JSON.parse(stored) as CallerIdentity);
    } catch {
      // ignore parse errors
    }
  }, []);

  const toggleToolMessages = () => {
    setHideToolMessages((prev) => !prev);
  };

  const setCaller = (c: CallerIdentity | null) => {
    setCallerState(c);
    try {
      if (c) {
        localStorage.setItem(CALLER_STORAGE_KEY, JSON.stringify(c));
      } else {
        localStorage.removeItem(CALLER_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  };

  return (
    <UISettingsContext.Provider
      value={{
        hideToolMessages,
        toggleToolMessages,
        caller,
        setCaller,
        approveAllTools,
        setApproveAllTools,
      }}
    >
      {children}
    </UISettingsContext.Provider>
  );
};

export const useUISettings = () => {
  const context = useContext(UISettingsContext);
  if (context === undefined) {
    throw new Error("useUISettings must be used within a UISettingsProvider");
  }
  return context;
};
