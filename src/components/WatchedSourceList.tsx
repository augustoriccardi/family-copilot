"use client";

import { useState, useEffect } from "react";
import {
  X,
  Plus,
  Edit,
  Trash2,
  Mail,
  Globe,
  Loader2,
  RefreshCcw,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { WatchedSourceForm } from "./WatchedSourceForm";
import type { WatchedSourceMember } from "./WatchedSourceForm";

interface WatchedSource {
  id: string;
  type: "GMAIL_LABEL" | "WEBPAGE" | "RSS";
  name: string;
  config: Record<string, unknown>;
  memberId: string | null;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastItemId: string | null;
  createdAt: string;
  member: WatchedSourceMember | null;
}

interface WatchedSourceListProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WatchedSourceList({ isOpen, onClose }: WatchedSourceListProps) {
  const [sources, setSources] = useState<WatchedSource[]>([]);
  const [members, setMembers] = useState<WatchedSourceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingSource, setEditingSource] = useState<WatchedSource | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchSources = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/watched-sources");
      if (res.ok) setSources(await res.json());
    } catch (err) {
      console.error("Failed to fetch watched sources:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async () => {
    try {
      const res = await fetch("/api/agent/members");
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSources();
      fetchMembers();
    }
  }, [isOpen]);

  const toggleSource = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    try {
      const res = await fetch("/api/watched-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      if (res.ok) {
        setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
      }
    } catch (err) {
      console.error("Failed to toggle source:", err);
    } finally {
      setTogglingId(null);
    }
  };

  const deleteSource = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar la fuente "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/watched-sources?id=${id}`, { method: "DELETE" });
      if (res.ok) setSources((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error("Failed to delete source:", err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleFormSaved = () => {
    fetchSources();
    setShowForm(false);
    setEditingSource(undefined);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingSource(undefined);
  };

  const handleEdit = (source: WatchedSource) => {
    setEditingSource(source);
    setShowForm(true);
  };

  if (!isOpen) return null;

  const typeLabel = (s: WatchedSource) => {
    if (s.type === "GMAIL_LABEL") {
      const label = s.config.label as string | undefined;
      return label ? `Gmail · ${label}` : "Gmail Label";
    }
    if (s.type === "WEBPAGE") {
      const url = s.config.url as string | undefined;
      try {
        return url ? `Web · ${new URL(url).hostname}` : "Página web";
      } catch {
        return "Página web";
      }
    }
    return s.type;
  };

  const formInitialValues = editingSource
    ? {
        id: editingSource.id,
        type: editingSource.type as "GMAIL_LABEL" | "WEBPAGE",
        name: editingSource.name,
        config: editingSource.config,
        memberId: editingSource.memberId,
        enabled: editingSource.enabled,
      }
    : undefined;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Fuentes externas
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Labels de Gmail y páginas web que el sistema monitorea automáticamente
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setEditingSource(undefined);
                  setShowForm(true);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus size={16} />
                Nueva fuente
              </button>
              <button
                onClick={fetchSources}
                disabled={loading}
                className="flex cursor-pointer items-center gap-1 px-2 py-1.5 text-sm text-gray-600 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                title="Refrescar"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCcw size={16} />
                )}
              </button>
              <button
                onClick={onClose}
                className="cursor-pointer text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[calc(90vh-100px)] overflow-y-auto p-4">
            {loading && sources.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            ) : sources.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                <Globe size={48} className="mx-auto mb-4 text-gray-300 dark:text-gray-600" />
                <p className="text-base font-medium">Sin fuentes configuradas</p>
                <p className="mt-1 text-sm">
                  Agregá un label de Gmail o una URL para que el sistema las monitoree.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      source.enabled
                        ? "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        : "border-gray-100 bg-gray-50 opacity-60 dark:border-gray-800 dark:bg-gray-800/40"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {/* Icon */}
                      <div className="shrink-0">
                        {source.type === "GMAIL_LABEL" ? (
                          <Mail
                            size={18}
                            className={source.enabled ? "text-blue-500" : "text-gray-400"}
                          />
                        ) : (
                          <Globe
                            size={18}
                            className={source.enabled ? "text-green-500" : "text-gray-400"}
                          />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {source.name}
                          </span>
                          {!source.enabled && (
                            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                              deshabilitada
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-700">
                            {typeLabel(source)}
                          </span>
                          {source.member && (
                            <span>
                              →{" "}
                              <span
                                className="font-medium"
                                style={{ color: source.member.color ?? undefined }}
                              >
                                {source.member.name}
                              </span>
                            </span>
                          )}
                          {source.lastCheckedAt && (
                            <span className="hidden sm:inline">
                              Último chequeo:{" "}
                              {new Date(source.lastCheckedAt).toLocaleDateString("es", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="ml-3 flex shrink-0 items-center gap-1">
                      {/* Toggle */}
                      <button
                        onClick={() => toggleSource(source.id, !source.enabled)}
                        disabled={togglingId === source.id}
                        className="cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        title={source.enabled ? "Deshabilitar" : "Habilitar"}
                      >
                        {togglingId === source.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : source.enabled ? (
                          <ToggleRight size={18} className="text-blue-500" />
                        ) : (
                          <ToggleLeft size={18} />
                        )}
                      </button>

                      {/* Edit */}
                      <button
                        onClick={() => handleEdit(source)}
                        className="cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                        title="Editar"
                      >
                        <Edit size={16} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => deleteSource(source.id, source.name)}
                        disabled={deletingId === source.id}
                        className="cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        title="Eliminar"
                      >
                        {deletingId === source.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Form modal (z-[60] to stack above the list modal) */}
      <WatchedSourceForm
        isOpen={showForm}
        onClose={handleFormClose}
        onSaved={handleFormSaved}
        members={members}
        initialValues={formInitialValues}
      />
    </>
  );
}
