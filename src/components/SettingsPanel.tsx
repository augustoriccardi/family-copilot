import { ChevronDown, ChevronUp, Settings, User } from "lucide-react";
import { ModelConfiguration } from "./ModelConfiguration";
import { useUISettings } from "@/contexts/UISettingsContext";
import { useEffect, useState } from "react";
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

function GoogleConnectButton({ memberId }: { memberId: string }) {
  const [status, setStatus] = useState<"idle" | "checking" | "connected" | "disconnected">(
    "checking",
  );

  useEffect(() => {
    // Check if this member already has a CalendarConnection
    fetch(`/api/google/status?memberId=${memberId}`)
      .then((r) => r.json())
      .then((d) => setStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("disconnected"));
  }, [memberId]);

  if (status === "checking") return null;

  if (status === "connected") {
    return (
      <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <span>✓</span> Google conectado
      </p>
    );
  }

  return (
    <a
      href={`/api/google/connect?memberId=${memberId}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        />
        <path
          fill="#EA4335"
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        />
      </svg>
      Conectar Google
    </a>
  );
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
                {caller && !members.find((m) => m.id === caller.callerId)?.isMinor && (
                  <GoogleConnectButton memberId={caller.callerId} />
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
