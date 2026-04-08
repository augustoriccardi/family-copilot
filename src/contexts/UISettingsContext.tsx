"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface UISettingsContextType {
  hideToolMessages: boolean;
  toggleToolMessages: () => void;
  approveAllTools: boolean;
  setApproveAllTools: (value: boolean) => void;
}

const UISettingsContext = createContext<UISettingsContextType | undefined>(undefined);

interface UISettingsProviderProps {
  children: ReactNode;
}

export const UISettingsProvider = ({ children }: UISettingsProviderProps) => {
  const [hideToolMessages, setHideToolMessages] = useState(true);
  const [approveAllTools, setApproveAllTools] = useState(true);

  const toggleToolMessages = () => {
    setHideToolMessages((prev) => !prev);
  };

  return (
    <UISettingsContext.Provider
      value={{
        hideToolMessages,
        toggleToolMessages,
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
