"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

type Member = {
  id: string;
  name: string;
  nickname: string | null;
  role: string;
  color: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  MADRE: "Madre",
  PADRE: "Padre",
  HIJO: "Hijo",
  HIJA: "Hija",
  ABUELO: "Abuelo",
  ABUELA: "Abuela",
  OTRO: "Otro",
};

const schema = z.object({
  memberId: z.string().cuid("Seleccioná tu perfil"),
});
type FormValues = z.infer<typeof schema>;

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const selectedId = watch("memberId");

  useEffect(() => {
    fetch("/api/auth/available-members")
      .then((r) => r.json())
      .then((data) => setMembers(data.members ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(data: FormValues) {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/linked-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: data.memberId }),
      });
      if (!res.ok) {
        const body = await res.json();
        setServerError(body.error ?? "Error al vincular el perfil");
        return;
      }
      router.replace("/");
    } catch {
      setServerError("Error de red, intentá de nuevo");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Bienvenido/a, {session?.user?.name?.split(" ")[0] ?? ""}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Seleccioná tu perfil dentro de la familia para continuar.
          </p>
        </div>

        {loading && <p className="text-center text-sm text-gray-400">Cargando perfiles…</p>}

        {!loading && members.length === 0 && (
          <div className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
            No hay perfiles disponibles para vincular. Pedile al administrador del hogar que te
            envíe una invitación.
          </div>
        )}

        {!loading && members.length > 0 && (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3">
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setValue("memberId", m.id, { shouldValidate: true })}
                  className={`flex items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors ${
                    selectedId === m.id
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                      : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                  }`}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: m.color ?? "#6B7280" }}
                  >
                    {(m.nickname ?? m.name)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {m.name}
                      {m.nickname ? ` (${m.nickname})` : ""}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {ROLE_LABELS[m.role] ?? m.role}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {errors.memberId && (
              <p className="text-center text-xs text-red-500">{errors.memberId.message}</p>
            )}
            {serverError && <p className="text-center text-sm text-red-500">{serverError}</p>}

            <button
              type="submit"
              disabled={!selectedId || isSubmitting}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting ? "Vinculando…" : "Este soy yo →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
