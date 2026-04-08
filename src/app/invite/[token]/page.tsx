"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

const ROLE_LABELS: Record<string, string> = {
  MADRE: "Madre",
  PADRE: "Padre",
  HIJO: "Hijo",
  HIJA: "Hija",
  ABUELO: "Abuelo",
  ABUELA: "Abuela",
  OTRO: "Otro",
};

type InvitationInfo = {
  member: { name: string; role: string };
  household: { name: string };
  invitedBy: { name: string | null };
  email: string;
};

export default function InvitePage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const { data: session, status } = useSession();

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/auth/invite/${params.token}/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setLoadError(data.error);
        else setInfo(data);
      })
      .catch(() => setLoadError("Error de red"));
  }, [params.token]);

  const callbackUrl = `/invite/${params.token}`;

  // Email of the logged-in user (if any)
  const sessionEmail = session?.user?.email ?? null;
  // Whether the logged-in user's email matches the invite
  const emailMismatch =
    status === "authenticated" && info && sessionEmail?.toLowerCase() !== info.email.toLowerCase();

  async function handleAccept() {
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`/api/auth/invite/${params.token}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAcceptError(data.error ?? "Error al aceptar la invitación");
        return;
      }
      router.replace("/");
    } catch {
      setAcceptError("Error de red, intentá de nuevo");
    } finally {
      setAccepting(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            Invitación no disponible
          </p>
          <p className="text-sm text-gray-500">{loadError}</p>
          <Link href="/login" className="text-sm text-blue-600 hover:underline">
            Ir al inicio
          </Link>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-400">Cargando invitación…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Family Copilot</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <strong>{info.invitedBy.name ?? "Alguien"}</strong> te invitó a unirte a{" "}
            <strong>{info.household.name}</strong>
          </p>
        </div>

        <div className="space-y-1 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs tracking-wide text-gray-400 uppercase">Tu perfil</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{info.member.name}</p>
          <p className="text-sm text-gray-500">
            {ROLE_LABELS[info.member.role] ?? info.member.role}
          </p>
        </div>

        {acceptError && <p className="text-center text-sm text-red-500">{acceptError}</p>}

        {/* Authenticated with wrong email */}
        {emailMismatch && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            <p>
              Estás logueado como <strong>{sessionEmail}</strong>. Esta invitación es para{" "}
              <strong>{info.email}</strong>.
            </p>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl })}
              className="mt-2 text-sm font-semibold underline"
            >
              Cerrar sesión para continuar
            </button>
          </div>
        )}

        {/* Authenticated with correct email */}
        {status === "authenticated" && !emailMismatch && (
          <button
            onClick={handleAccept}
            disabled={accepting}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {accepting ? "Aceptando…" : "Aceptar invitación"}
          </button>
        )}

        {/* Unauthenticated: offer register + login */}
        {status === "unauthenticated" && info && (
          <div className="space-y-2">
            <p className="text-center text-xs text-gray-400">
              Usá el email <strong>{info.email}</strong> para que la vinculación sea automática.
            </p>
            <Link
              href={`/register?email=${encodeURIComponent(info.email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="block w-full rounded-md bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Crear cuenta
            </Link>
            <button
              type="button"
              onClick={() => signIn(undefined, { callbackUrl })}
              className="w-full rounded-md border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Ya tengo cuenta, iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
