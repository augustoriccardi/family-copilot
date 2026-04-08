import { ChevronDown, ChevronUp, LogOut, Settings, User, Mail, Trash2, Plus } from "lucide-react";
import { ModelConfiguration } from "./ModelConfiguration";
import { useUISettings } from "@/contexts/UISettingsContext";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession, signOut } from "next-auth/react";

// ─── Calendar mapping types ─────────────────────────────────────────────────

type MemberCalendarRow = {
  id: string;
  googleCalendarId: string;
  displayName: string | null;
  type: string;
  isPrimary: boolean;
};

type GoogleCalItem = {
  id: string;
  summary: string;
  primary: boolean;
};

const CAL_TYPE_LABELS: Record<string, string> = {
  PERSONAL: "Personal",
  FAMILY_SHARED: "Familiar compartido",
  WORK: "Trabajo",
  SCHOOL: "Escuela",
  OTHER: "Otro",
};

/** Maps the user's Google calendars to family member calendar slots. */
function CalendarMappingSection() {
  const [mappings, setMappings] = useState<MemberCalendarRow[]>([]);
  const [googleCals, setGoogleCals] = useState<GoogleCalItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const [selectedCalId, setSelectedCalId] = useState("");
  const [selectedType, setSelectedType] = useState("FAMILY_SHARED");
  const [isPrimary, setIsPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/google/member-calendars")
      .then((r) => r.json())
      .then((d) => setMappings(d.memberCalendars ?? []))
      .catch(() => {});
  }, []);

  async function handleOpenAdd() {
    setShowAdd(true);
    if (googleCals.length === 0) {
      setLoadingGoogle(true);
      try {
        const res = await fetch("/api/google/member-calendars?source=google");
        const d = await res.json();
        if (d.notConnected) {
          setNotConnected(true);
        } else {
          setGoogleCals(d.calendars ?? []);
          const mapped = new Set(mappings.map((m) => m.googleCalendarId));
          const first = (d.calendars ?? []).find((c: GoogleCalItem) => !mapped.has(c.id));
          if (first) setSelectedCalId(first.id);
        }
      } catch {
        // ignore
      } finally {
        setLoadingGoogle(false);
      }
    }
  }

  async function handleAdd() {
    if (!selectedCalId) return;
    setSaving(true);
    setError(null);
    try {
      const cal = googleCals.find((c) => c.id === selectedCalId);
      const res = await fetch("/api/google/member-calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleCalendarId: selectedCalId,
          displayName: cal?.summary ?? selectedCalId,
          type: selectedType,
          isPrimary,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Error al guardar");
        return;
      }
      setMappings(d.memberCalendars ?? []);
      setShowAdd(false);
      setSelectedType("FAMILY_SHARED");
      setIsPrimary(false);
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/google/member-calendars/${id}`, { method: "DELETE" });
    setMappings((prev) => prev.filter((m) => m.id !== id));
  }

  const mappedIds = new Set(mappings.map((m) => m.googleCalendarId));
  const available = googleCals.filter((c) => !mappedIds.has(c.id));

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Calendarios Google</p>
        {!showAdd && (
          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            <Plus className="h-3 w-3" /> Agregar
          </button>
        )}
      </div>

      {/* Existing mappings */}
      {mappings.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between rounded bg-gray-100 px-2 py-1 dark:bg-gray-700"
        >
          <div className="min-w-0">
            <span className="block truncate text-xs text-gray-700 dark:text-gray-200">
              {m.displayName ?? m.googleCalendarId}
            </span>
            <span className="text-xs text-gray-400">
              {CAL_TYPE_LABELS[m.type] ?? m.type}
              {m.isPrimary ? " · principal" : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleDelete(m.id)}
            className="ml-1 shrink-0 text-gray-400 hover:text-red-500"
            title="Eliminar mapeo"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}

      {mappings.length === 0 && !showAdd && (
        <p className="text-xs text-gray-400">Sin calendarios configurados.</p>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="space-y-1.5 rounded-md border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/20">
          {loadingGoogle && <p className="text-xs text-gray-400">Cargando calendarios…</p>}
          {!loadingGoogle && notConnected && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Primero{" "}
              <a href="/api/google/connect" className="underline">
                conectá Google Calendar
              </a>
              .
            </p>
          )}
          {!loadingGoogle && !notConnected && available.length === 0 && googleCals.length > 0 && (
            <p className="text-xs text-gray-400">Todos tus calendarios ya están configurados.</p>
          )}
          {!loadingGoogle && !notConnected && available.length > 0 && (
            <>
              <select
                value={selectedCalId}
                onChange={(e) => setSelectedCalId(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? " (principal)" : ""}
                  </option>
                ))}
              </select>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                {Object.entries(CAL_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                />
                Usar como principal para nuevos eventos
              </label>
            </>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setError(null);
              }}
              className="flex-1 rounded border border-gray-300 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            {!loadingGoogle && !notConnected && available.length > 0 && (
              <button
                type="button"
                onClick={handleAdd}
                disabled={!selectedCalId || saving}
                className="flex-1 rounded bg-blue-600 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FamilyMember option type ─────────────────────────────────────────────────

interface FamilyMemberOption {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  color: string | null;
  isMinor: boolean;
  linkedUserId: string | null;
}

async function fetchMembers(threadId: string): Promise<FamilyMemberOption[]> {
  const res = await fetch(`/api/agent/members?threadId=${threadId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.members ?? []) as FamilyMemberOption[];
}

/** Shows the current Google Calendar connection status for the logged-in user. */
function GoogleConnectionStatus() {
  const [status, setStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d.connected ? "connected" : "disconnected");
        setEmail(d.email ?? null);
      })
      .catch(() => setStatus("disconnected"));
  }, []);

  if (status === "checking") return null;

  if (status === "connected") {
    return (
      <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <span>✓</span> Google conectado{email ? ` (${email})` : ""}
      </p>
    );
  }

  return (
    <a
      href="/api/google/connect"
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
      Conectar Google Calendar
    </a>
  );
}

/** Lets the user link their account to a FamilyMember if not yet linked. */
function MemberLinkSection({ members }: { members: FamilyMemberOption[] }) {
  const { data: session } = useSession();
  const [linked, setLinked] = useState<FamilyMemberOption | null>(null);
  const [linking, setLinking] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/auth/linked-member`)
      .then((r) => r.json())
      .then((d) => {
        if (d.member) setLinked(d.member as FamilyMemberOption);
      })
      .catch(() => {});
  }, [session?.user?.id]);

  if (linked) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Perfil familiar:{" "}
          <strong className="text-gray-700 dark:text-gray-200">{linked.name}</strong>{" "}
          <span className="text-gray-400">({linked.role})</span>
        </p>
        <GoogleConnectionStatus />
        <CalendarMappingSection />
      </div>
    );
  }

  const adults = members.filter((m) => !m.isMinor);

  return (
    <div className="space-y-2">
      <p className="text-xs text-amber-600 dark:text-amber-400">
        Vinculá tu cuenta a un perfil familiar para que el agente te identifique.
      </p>
      {adults.length > 0 && (
        <div className="flex gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">— Elegí tu perfil —</option>
            {adults.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedId || linking}
            onClick={async () => {
              if (!selectedId) return;
              setLinking(true);
              await fetch("/api/auth/linked-member", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ memberId: selectedId }),
              });
              const m = members.find((x) => x.id === selectedId) ?? null;
              setLinked(m);
              setLinking(false);
            }}
            className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {linking ? "…" : "Vincular"}
          </button>
        </div>
      )}
      <GoogleConnectionStatus />
    </div>
  );
}

/** Admin-only: manage pending invitations and invite new members. */
function InvitationsSection({ members }: { members: FamilyMemberOption[] }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [invitations, setInvitations] = useState<
    { id: string; email: string; member: { name: string; role: string }; expiresAt: string }[]
  >([]);
  const [email, setEmail] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/invite")
      .then((r) => {
        if (r.status === 200) setIsAdmin(true);
        return r.json();
      })
      .then((d) => setInvitations(d.invitations ?? []))
      .catch(() => {});
  }, []);

  if (!isAdmin) return null;

  // Show only adults that don't yet have a linked user account
  const unlinked = members.filter((m) => !m.linkedUserId);

  async function handleInvite() {
    if (!email || !memberId) return;
    setSending(true);
    setError(null);
    setInviteUrl(null);
    try {
      const res = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, memberId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Error al crear invitación");
        return;
      }
      setInviteUrl(data.inviteUrl);
      setEmail("");
      setMemberId("");
      // Refresh list
      const updated = await fetch("/api/auth/invite").then((r) => r.json());
      setInvitations(updated.invitations ?? []);
    } catch {
      setError("Error de red");
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/auth/invite?id=${id}`, { method: "DELETE" });
    setInvitations((prev) => prev.filter((i) => i.id !== id));
  }

  return (
    <div className="space-y-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-900/20">
      <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Invitar miembros</p>

      <div className="flex flex-col gap-2">
        <input
          type="email"
          placeholder="email@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <select
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">— Perfil a vincular —</option>
          {unlinked.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.role})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!email || !memberId || sending}
          onClick={handleInvite}
          className="flex items-center justify-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Mail className="h-3 w-3" />
          {sending ? "Enviando…" : "Enviar invitación"}
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {inviteUrl && (
        <div className="rounded-md bg-green-50 p-2 dark:bg-green-900/20">
          <p className="text-xs font-medium text-green-700 dark:text-green-300">
            Link de invitación:
          </p>
          <p className="mt-1 text-xs break-all text-green-600 dark:text-green-400">{inviteUrl}</p>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(inviteUrl)}
            className="mt-1.5 rounded border border-green-300 px-2 py-0.5 text-xs text-green-700 hover:bg-green-100 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900/40"
          >
            Copiar link
          </button>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-gray-500">Invitaciones pendientes:</p>
          {invitations.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between rounded bg-white px-2 py-1 text-xs dark:bg-gray-800"
            >
              <span className="truncate text-gray-700 dark:text-gray-300">
                {inv.email} → {inv.member.name}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(inv.id)}
                className="ml-2 text-gray-400 hover:text-red-500"
                title="Cancelar invitación"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Family settings (edit household + members) ──────────────────────────────

const ROLE_LABELS_SETTINGS: Record<string, string> = {
  MADRE: "Madre",
  PADRE: "Padre",
  HIJO: "Hijo",
  HIJA: "Hija",
  ABUELO: "Abuelo",
  ABUELA: "Abuela",
  OTRO: "Otro",
};
const FAMILY_ROLES_LIST = ["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"] as const;
const MEMBER_COLORS = [
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#A855F7",
  "#EC4899",
  "#6B7280",
  "#92400E",
];
const TIMEZONES_LIST = [
  { value: "America/Montevideo", label: "Uruguay (UTC-3)" },
  { value: "America/Buenos_Aires", label: "Argentina (UTC-3)" },
  { value: "America/Santiago", label: "Chile (UTC-4/3)" },
  { value: "America/Bogota", label: "Colombia (UTC-5)" },
  { value: "America/Lima", label: "Perú (UTC-5)" },
  { value: "America/Mexico_City", label: "México (UTC-6)" },
  { value: "America/New_York", label: "Este EE.UU. (UTC-5)" },
  { value: "America/Los_Angeles", label: "Oeste EE.UU. (UTC-8)" },
  { value: "Europe/Madrid", label: "España (UTC+1)" },
  { value: "Europe/London", label: "Reino Unido (UTC+0)" },
];

type EditableMember = {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  isMinor: boolean;
  color: string | null;
  birthdate: string | null;
  email: string | null;
  whatsappPhone: string | null;
  schoolName: string | null;
  linkedUserId: string | null;
};

function MemberEditRow({
  member,
  isOwner,
  onSaved,
  onDeleted,
}: {
  member: EditableMember;
  isOwner: boolean;
  onSaved: (m: EditableMember) => void;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: member.name,
    nickname: member.nickname ?? "",
    role: member.role,
    isMinor: member.isMinor,
    color: member.color ?? "#6B7280",
    birthdate: member.birthdate ? member.birthdate.slice(0, 10) : "",
    email: member.email ?? "",
    whatsappPhone: member.whatsappPhone ?? "",
    schoolName: member.schoolName ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        ...form,
        nickname: form.nickname || null,
        birthdate: form.birthdate || null,
        email: form.email || null,
        whatsappPhone: form.whatsappPhone || null,
        schoolName: form.schoolName || null,
      };
      const res = await fetch(`/api/household/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(typeof d.error === "string" ? d.error : "Error al guardar");
        return;
      }
      onSaved({ ...member, ...d.member });
      setOpen(false);
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`¿Eliminar a ${member.name}? Esta acción no se puede deshacer.`)) return;
    const res = await fetch(`/api/household/members/${member.id}`, { method: "DELETE" });
    if (res.ok) onDeleted(member.id);
    else {
      const d = await res.json();
      alert(typeof d.error === "string" ? d.error : "Error al eliminar");
    }
  }

  const inputCls =
    "w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: form.color }} />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
            {member.name}
          </span>
          <span className="text-xs text-gray-400">
            {ROLE_LABELS_SETTINGS[member.role] ?? member.role}
          </span>
          {member.linkedUserId && (
            <span className="rounded bg-green-100 px-1 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
              vinculado
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronDown className="h-3 w-3 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-gray-100 px-3 pt-2 pb-3 dark:border-gray-700">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Nombre *</label>
              <input
                className={inputCls}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Apodo</label>
              <input
                className={inputCls}
                value={form.nickname}
                onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-500">Color</label>
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    borderColor: form.color === c ? "white" : "transparent",
                    outline: form.color === c ? `2px solid ${c}` : "none",
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Rol</label>
              <select
                className={inputCls}
                value={form.role}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    role: e.target.value,
                    isMinor: ["HIJO", "HIJA"].includes(e.target.value),
                  }))
                }
              >
                {FAMILY_ROLES_LIST.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS_SETTINGS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Fecha de nac.</label>
              <input
                type="date"
                className={inputCls}
                value={form.birthdate}
                onChange={(e) => setForm((f) => ({ ...f, birthdate: e.target.value }))}
              />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={form.isMinor}
              onChange={(e) => setForm((f) => ({ ...f, isMinor: e.target.checked }))}
              className="h-3.5 w-3.5 rounded"
            />
            Es menor de edad
          </label>

          {!form.isMinor && (
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">WhatsApp</label>
              <input
                type="tel"
                className={inputCls}
                value={form.whatsappPhone}
                onChange={(e) => setForm((f) => ({ ...f, whatsappPhone: e.target.value }))}
                placeholder="+598 99..."
              />
            </div>
          )}

          {form.isMinor && (
            <div>
              <label className="mb-0.5 block text-xs text-gray-500">Colegio</label>
              <input
                className={inputCls}
                value={form.schoolName}
                onChange={(e) => setForm((f) => ({ ...f, schoolName: e.target.value }))}
                placeholder="Opcional"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            {isOwner && !member.linkedUserId && (
              <button
                type="button"
                onClick={handleDelete}
                className="text-xs text-red-500 hover:underline"
              >
                Eliminar
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.name}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FamilySettingsSection({ allMembers }: { allMembers: FamilyMemberOption[] }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [household, setHousehold] = useState<{ name: string; timezone: string } | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<EditableMember[]>([]);
  const [hhName, setHhName] = useState("");
  const [hhTz, setHhTz] = useState("America/Montevideo");
  const [hhSaving, setHhSaving] = useState(false);
  const [hhError, setHhError] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMember, setNewMember] = useState({ name: "", role: "HIJO" as string, isMinor: true });
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch("/api/household")
      .then((r) => r.json())
      .then((d) => {
        if (d.household) {
          setHousehold(d.household);
          setHhName(d.household.name);
          setHhTz(d.household.timezone);
          setIsOwner(d.isOwner);
        }
      })
      .catch(() => {});
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) return;
    // Fetch full member data including email/phone/school
    fetch("/api/household/members")
      .then((r) => r.json())
      .then((d) => {
        if (d.members) setMembers(d.members);
      })
      .catch(() => {
        // fall back to allMembers prop without extra fields
        setMembers(
          allMembers.map((m) => ({
            ...m,
            birthdate: null,
            email: null,
            whatsappPhone: null,
            schoolName: null,
          })) as EditableMember[],
        );
      });
  }, [session?.user?.id, allMembers]);

  async function handleSaveHousehold() {
    setHhSaving(true);
    setHhError(null);
    try {
      const res = await fetch("/api/household", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: hhName, timezone: hhTz }),
      });
      const d = await res.json();
      if (!res.ok) {
        setHhError(typeof d.error === "string" ? d.error : "Error al guardar");
        return;
      }
      setHousehold(d.household);
    } catch {
      setHhError("Error de red");
    } finally {
      setHhSaving(false);
    }
  }

  async function handleAddMember() {
    setAddSaving(true);
    setAddError(null);
    try {
      const res = await fetch("/api/household/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMember),
      });
      const d = await res.json();
      if (!res.ok) {
        setAddError(typeof d.error === "string" ? d.error : "Error");
        return;
      }
      setMembers((prev) => [
        ...prev,
        { ...d.member, birthdate: null, email: null, whatsappPhone: null, schoolName: null },
      ]);
      setNewMember({ name: "", role: "HIJO", isMinor: true });
      setShowAddMember(false);
      // Refresh React Query cache so InvitationsSection sees the new member
      await queryClient.invalidateQueries({ queryKey: ["household-members"] });
    } catch {
      setAddError("Error de red");
    } finally {
      setAddSaving(false);
    }
  }

  if (!household) return null;

  const inputCls =
    "w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";

  return (
    <div className="space-y-1.5 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
          Hogar y familia
        </span>
        {open ? (
          <ChevronUp className="h-3 w-3 text-gray-400" />
        ) : (
          <ChevronDown className="h-3 w-3 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="space-y-3 pt-1">
          {/* Household */}
          {isOwner && (
            <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Datos del hogar
              </p>
              <div>
                <label className="mb-0.5 block text-xs text-gray-500">Nombre</label>
                <input
                  className={inputCls}
                  value={hhName}
                  onChange={(e) => setHhName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs text-gray-500">Zona horaria</label>
                <select className={inputCls} value={hhTz} onChange={(e) => setHhTz(e.target.value)}>
                  {TIMEZONES_LIST.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
              {hhError && <p className="text-xs text-red-500">{hhError}</p>}
              <button
                type="button"
                onClick={handleSaveHousehold}
                disabled={hhSaving || !hhName}
                className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {hhSaving ? "Guardando…" : "Guardar hogar"}
              </button>
            </div>
          )}

          {/* Members */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Integrantes</p>
              {isOwner && !showAddMember && (
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  className="flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  <Plus className="h-3 w-3" /> Agregar
                </button>
              )}
            </div>

            {members.map((m) => (
              <MemberEditRow
                key={m.id}
                member={m}
                isOwner={isOwner}
                onSaved={(updated) =>
                  setMembers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
                }
                onDeleted={(id) => setMembers((prev) => prev.filter((x) => x.id !== id))}
              />
            ))}

            {showAddMember && (
              <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/20">
                <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  Nuevo integrante
                </p>
                <input
                  className={inputCls}
                  placeholder="Nombre *"
                  value={newMember.name}
                  onChange={(e) => setNewMember((f) => ({ ...f, name: e.target.value }))}
                />
                <select
                  className={inputCls}
                  value={newMember.role}
                  onChange={(e) =>
                    setNewMember((f) => ({
                      ...f,
                      role: e.target.value,
                      isMinor: ["HIJO", "HIJA"].includes(e.target.value),
                    }))
                  }
                >
                  {FAMILY_ROLES_LIST.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS_SETTINGS[r]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={newMember.isMinor}
                    onChange={(e) => setNewMember((f) => ({ ...f, isMinor: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded"
                  />
                  Es menor de edad
                </label>
                {addError && <p className="text-xs text-red-500">{addError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMember(false);
                      setAddError(null);
                    }}
                    className="flex-1 rounded border border-gray-300 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:border-gray-600"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleAddMember}
                    disabled={addSaving || !newMember.name}
                    className="flex-1 rounded bg-blue-600 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {addSaving ? "Guardando…" : "Agregar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

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
  const { approveAllTools, setApproveAllTools } = useUISettings();
  const { data: session } = useSession();

  const { data: members = [] } = useQuery<FamilyMemberOption[]>({
    queryKey: ["household-members", threadId],
    queryFn: () => fetchMembers(threadId ?? ""),
    enabled: true,
    staleTime: 60_000,
  });

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
              {session?.user?.name && (
                <span className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  <User className="h-3 w-3" />
                  {session.user.name}
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
        <div className="animate-in slide-in-from-top-2 max-h-[60vh] overflow-y-auto px-4 pb-3 duration-200">
          <div className="space-y-3">
            {/* Session user + family member link */}
            {session?.user && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    {session.user.name ?? session.user.email}
                  </p>
                  <button
                    type="button"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    title="Cerrar sesión"
                  >
                    <LogOut className="h-3 w-3" />
                  </button>
                </div>
                <MemberLinkSection members={members} />
                <InvitationsSection members={members} />
                <FamilySettingsSection allMembers={members} />
              </div>
            )}

            {/* Model Configuration — solo visible para el dueño del hogar */}
            <ModelConfiguration
              provider={provider}
              setProvider={setProvider}
              model={model}
              setModel={setModel}
            />
          </div>
        </div>
      )}
    </div>
  );
};
