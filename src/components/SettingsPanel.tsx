import { ChevronDown, ChevronUp, Settings, User } from "lucide-react";
import { ModelConfiguration } from "./ModelConfiguration";
import { useMCPTools } from "@/hooks/useMCPTools";
import { useUISettings } from "@/contexts/UISettingsContext";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

interface FamilyMemberOption {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  color: string | null;
  isMinor: boolean;
}

async function fetchMembers(threadId: string): Promise<FamilyMemberOption[]> {
  const res = await fetch(`/api/agent/members?threadId=${threadId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.members ?? []) as FamilyMemberOption[];
}

interface SettingsPanelProps {
  isExpanded: boolean;
  onToggle: () => void;
  provider: string;
  setProvider: (provider: string) => void;
  model: string;
  setModel: (model: string) => void;
  threadId?: string;
}

export const SettingsPanel = ({
  isExpanded,
  onToggle,
  provider,
  setProvider,
  model,
  setModel,
  threadId,
}: SettingsPanelProps) => {
  const { data: mcpToolsData } = useMCPTools();
  const { caller, setCaller } = useUISettings();

  const { data: members = [] } = useQuery<FamilyMemberOption[]>({
    queryKey: ["household-members", threadId],
    queryFn: () => fetchMembers(threadId ?? ""),
    enabled: true,
    staleTime: 60_000,
  });

  // When members load, validate the stored callerId — if it no longer exists (e.g. after
  // a seed reset), clear it so the user doesn't silently send a stale/invalid ID.
  useEffect(() => {
    if (members.length > 0 && caller?.callerId) {
      const stillValid = members.some((m) => m.id === caller.callerId);
      if (!stillValid) {
        setCaller(null);
      }
    }
  }, [members, caller?.callerId, setCaller]);

  const handleMemberChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    if (!selectedId) {
      setCaller(null);
      return;
    }
    const member = members.find((m) => m.id === selectedId);
    if (member) {
      setCaller({
        callerId: member.id,
        callerName: member.name,
        callerRole: member.role,
        callerColor: member.color,
      });
    }
  };

  return (
    <div className="border-b border-gray-200 dark:border-gray-700">
      {/* Settings Header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        aria-expanded={isExpanded}
        aria-label="Toggle settings panel"
      >
        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
          {!isExpanded && (
            <>
              <span className="text-xs text-gray-500">
                {provider} / {model}
              </span>
              {(mcpToolsData?.totalCount ?? 0) > 0 && (
                <span className="text-xs text-gray-500">
                  - {mcpToolsData?.totalCount ?? 0} tools available
                </span>
              )}
              {caller && (
                <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  <User className="h-3 w-3" />
                  {caller.callerName}
                </span>
              )}
            </>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        )}
      </button>

      {/* Settings Content */}
      {isExpanded && (
        <div className="animate-in slide-in-from-top-2 px-4 pb-3 duration-200">
          <div className="space-y-3">
            {/* Member selector */}
            {members.length > 0 && (
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  ¿Quién sos?
                </label>
                <select
                  value={caller?.callerId ?? ""}
                  onChange={handleMemberChange}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">— Sin identificar —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.nickname ? ` (${m.nickname})` : ""}
                    </option>
                  ))}
                </select>
                {caller && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    El agente sabe que sos <strong>{caller.callerName}</strong>. Los eventos sin
                    destinatario se asignan a vos.
                  </p>
                )}
              </div>
            )}

            {/* Model Configuration */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                AI Model
              </label>
              <ModelConfiguration
                provider={provider}
                setProvider={setProvider}
                model={model}
                setModel={setModel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
