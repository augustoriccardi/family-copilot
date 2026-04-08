"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, XCircle, Inbox, ChevronDown, ChevronUp, Clock } from "lucide-react";

type ProposalType = "EVENT" | "REMINDER" | "SHOPPING_ITEM" | "DOCUMENT" | "OTHER";

interface Proposal {
  id: string;
  title: string;
  description?: string | null;
  type: ProposalType;
  source: string;
  confidence: number;
  notes?: string | null;
  payload: Record<string, unknown>;
  member?: { id: string; name: string; color?: string | null } | null;
  createdAt: string;
}

const TYPE_LABEL: Record<ProposalType, string> = {
  EVENT: "Evento",
  REMINDER: "Recordatorio",
  SHOPPING_ITEM: "Producto",
  DOCUMENT: "Documento",
  OTHER: "Otro",
};

const TYPE_COLOR: Record<ProposalType, string> = {
  EVENT: "bg-blue-100 text-blue-700",
  REMINDER: "bg-yellow-100 text-yellow-700",
  SHOPPING_ITEM: "bg-green-100 text-green-700",
  DOCUMENT: "bg-purple-100 text-purple-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const SOURCE_ICON: Record<string, string> = {
  email: "✉️",
  pdf: "📄",
  image: "🖼️",
  whatsapp: "📱",
  web: "🌐",
  manual: "✏️",
};

function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.85 ? "bg-green-500" : value >= 0.6 ? "bg-yellow-400" : "bg-red-400";
  const label = value >= 0.85 ? "Alta" : value >= 0.6 ? "Media" : "Baja";
  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export function ProposalInbox({ threadId }: { threadId?: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: "PENDING" });
      if (threadId) qs.set("threadId", threadId);
      const res = await fetch(`/api/agent/proposals?${qs}`);
      if (!res.ok) return;
      const data = await res.json();
      setProposals(data.proposals ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  const prevCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchProposals();
    // Only start one interval — clear previous if threadId changes
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchProposals, 30_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchProposals]);

  // Auto-expand when the pending count grows (new proposal arrived)
  useEffect(() => {
    if (proposals.length > prevCountRef.current) {
      setIsExpanded(true);
    }
    prevCountRef.current = proposals.length;
  }, [proposals.length]);

  const [approveErrors, setApproveErrors] = useState<Record<string, string>>({});

  const approve = async (id: string) => {
    setActioning(id);
    setApproveErrors((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    try {
      const res = await fetch(`/api/agent/proposals/${id}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setApproveErrors((prev) => ({
          ...prev,
          [id]: data.error ?? "No se pudo aprobar la propuesta.",
        }));
        return;
      }
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setActioning(null);
    }
  };

  const reject = async (id: string) => {
    setActioning(id);
    try {
      await fetch(`/api/agent/proposals/${id}/reject`, { method: "POST" });
      setProposals((prev) => prev.filter((p) => p.id !== id));
    } finally {
      setActioning(null);
    }
  };

  const pendingCount = proposals.length;

  return (
    <div className="mb-4">
      {/* Header / toggle */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
      >
        <span className="flex items-center gap-2">
          <Inbox size={15} className="text-gray-500" />
          Propuestas pendientes
          {pendingCount > 0 && (
            <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-xs leading-none font-semibold text-white">
              {pendingCount}
            </span>
          )}
        </span>
        {loading ? (
          <Clock size={13} className="animate-spin text-gray-400" />
        ) : isExpanded ? (
          <ChevronUp size={13} className="text-gray-400" />
        ) : (
          <ChevronDown size={13} className="text-gray-400" />
        )}
      </button>

      {/* Proposals list */}
      {isExpanded && (
        <div className="mt-1 space-y-2 px-1">
          {pendingCount === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-gray-400">
              No hay propuestas pendientes
            </p>
          ) : (
            proposals.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-gray-100 bg-white p-3 text-xs shadow-sm"
              >
                {/* Type + source */}
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium ${TYPE_COLOR[p.type]}`}
                  >
                    {TYPE_LABEL[p.type]}
                  </span>
                  <span className="text-gray-400">
                    {SOURCE_ICON[p.source] ?? "📥"} {p.source}
                  </span>
                  <span className="ml-auto">
                    <ConfidenceDot value={p.confidence} />
                  </span>
                </div>

                {/* Title */}
                <p className="mb-1 leading-snug font-medium text-gray-800">{p.title}</p>

                {/* Member */}
                {p.member && (
                  <p className="mb-1 text-gray-500">
                    Para:{" "}
                    <span className="font-medium" style={{ color: p.member.color ?? undefined }}>
                      {p.member.name}
                    </span>
                  </p>
                )}

                {/* Notes */}
                {p.notes && <p className="mb-1.5 leading-snug text-gray-400 italic">{p.notes}</p>}

                {/* Approve error */}
                {approveErrors[p.id] && (
                  <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-[11px] leading-snug text-red-600">
                    {approveErrors[p.id]}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-2 flex gap-2">
                  <button
                    disabled={actioning === p.id}
                    onClick={() => approve(p.id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-green-50 px-2 py-1.5 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                  >
                    <CheckCircle size={12} />
                    Aprobar
                  </button>
                  <button
                    disabled={actioning === p.id}
                    onClick={() => reject(p.id)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                  >
                    <XCircle size={12} />
                    Rechazar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
