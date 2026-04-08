"use client";

import { useEffect, useState } from "react";
import { BrainCog, Check, Eye, EyeOff, Save } from "lucide-react";
import Image from "next/image";

// Only models that support: tool/function calling, streaming, and multimodal (vision) input.
// gemini-2.0-flash-lite is excluded — no reliable parallel tool calling for agentic patterns.
// gpt-4o-mini uses the pinned date-versioned ID to match the internal agent default.
const MODELS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
  google: [
    { value: "gemini-2.5-pro-preview-03-25", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  openai: [
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini-2024-07-18", label: "GPT-4o mini" },
  ],
};

const selectCls =
  "w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200";
const inputCls =
  "w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200";

interface ModelConfigurationProps {
  provider: string;
  setProvider: (provider: string) => void;
  model: string;
  setModel: (model: string) => void;
  approveAllTools?: boolean;
  setApproveAllTools?: (approveAllTools: boolean) => void;
}

export const ModelConfiguration = ({
  provider,
  setProvider,
  model,
  setModel,
}: ModelConfigurationProps) => {
  const models = MODELS_BY_PROVIDER[provider] ?? [];

  // API key state
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [keySet, setKeySet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Load saved config on mount
  useEffect(() => {
    fetch("/api/household/ai-config")
      .then((r) => r.json())
      .then((d) => {
        if (d.aiProvider) {
          setProvider(d.aiProvider);
        }
        if (d.aiModel) {
          setModel(d.aiModel);
        }
        setKeySet(!!d.aiApiKeySet);
        setKeyHint(d.aiApiKeyHint ?? null);
        setIsOwner(!!d.isOwner);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    const defaultModel = MODELS_BY_PROVIDER[newProvider]?.[0]?.value ?? "";
    setModel(defaultModel);
  }

  async function handleSaveConfig() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const body: Record<string, string> = { aiProvider: provider, aiModel: model };
      if (apiKey !== "") body.aiApiKey = apiKey;
      const res = await fetch("/api/household/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (res.ok) {
        setKeySet(!!d.aiApiKeySet);
        setKeyHint(d.aiApiKeyHint ?? null);
        setApiKey("");
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError(d.error ? JSON.stringify(d.error) : `Error ${res.status}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      {!isOwner ? null : (
        <>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            AI Model
          </label>
          <div className="space-y-3">
            {/* Provider */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                Proveedor
              </label>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
                  <Image
                    src={`/${provider.toLowerCase()}.svg`}
                    alt={provider}
                    width={24}
                    height={24}
                    className="object-contain p-0.5"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                  <BrainCog className="h-4 w-4" />
                </span>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value)}
                  className={selectCls}
                >
                  <option value="google">Google</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                Modelo
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={selectCls}
              >
                {models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                API Key{" "}
                {keySet && keyHint && (
                  <span className="ml-1 font-normal text-green-600 dark:text-green-400">
                    (guardada {keyHint})
                  </span>
                )}
              </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      keySet
                        ? "Nueva clave para reemplazar…"
                        : provider === "google"
                          ? "AIza…"
                          : "sk-…"
                    }
                    className={inputCls + " pr-8"}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="flex shrink-0 items-center gap-1 rounded border border-blue-500 bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
                  {saved ? "Guardado" : "Guardar"}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Se guarda en el hogar y se usa para todas las conversaciones de la familia.
              </p>
              {saveError && <p className="text-xs text-red-500">{saveError}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
