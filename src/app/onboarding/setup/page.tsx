"use client";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PlusCircle, Trash2, ChevronRight, ChevronLeft, Home, Users, User } from "lucide-react";
import { useState } from "react";

// ─── Schema ──────────────────────────────────────────────────────────────────

const FAMILY_ROLES = ["MADRE", "PADRE", "HIJO", "HIJA", "ABUELO", "ABUELA", "OTRO"] as const;
type FamilyRole = (typeof FAMILY_ROLES)[number];

const TIMEZONE_VALUES = [
  "America/Montevideo",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Bogota",
  "America/Lima",
  "America/Mexico_City",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "Europe/London",
] as const;

const memberSchema = z.object({
  name: z.string().min(1, "El nombre es requerido").max(100),
  nickname: z.string().max(50).optional(),
  role: z.enum(FAMILY_ROLES),
  isMinor: z.boolean(),
  color: z.string(),
  birthdate: z.string().optional(),
  email: z.union([z.literal(""), z.string().email("Email inválido")]).optional(),
  whatsappPhone: z.string().max(30).optional(),
  schoolName: z.string().max(100).optional(),
});

const setupSchema = z
  .object({
    householdName: z.string().min(1, "El nombre del hogar es requerido").max(100),
    timezone: z.enum(TIMEZONE_VALUES),
    members: z.array(memberSchema).min(1, "Agregá al menos un integrante").max(20),
    selfIndex: z.number({ invalid_type_error: "Seleccioná tu perfil" }).int().min(0),
  })
  .refine((d) => d.members.some((m) => !m.isMinor), {
    message: "Necesitás al menos un integrante adulto",
    path: ["members"],
  })
  .refine((d) => d.selfIndex < d.members.length, {
    message: "Perfil inválido",
    path: ["selfIndex"],
  })
  .refine((d) => !d.members[d.selfIndex]?.isMinor, {
    message: "Tu perfil no puede ser el de un menor",
    path: ["selfIndex"],
  });

type SetupFormValues = z.infer<typeof setupSchema>;

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<FamilyRole, string> = {
  MADRE: "Madre",
  PADRE: "Padre",
  HIJO: "Hijo",
  HIJA: "Hija",
  ABUELO: "Abuelo",
  ABUELA: "Abuela",
  OTRO: "Otro",
};

const MINOR_ROLES: FamilyRole[] = ["HIJO", "HIJA"];

const TIMEZONES: { value: (typeof TIMEZONE_VALUES)[number]; label: string }[] = [
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

const PRESET_COLORS = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FFEAA7",
  "#DDA0DD",
  "#98D8C8",
  "#F7DC6F",
  "#FF9F43",
  "#A29BFE",
];

const STEP_ICONS = [Home, Users, User];
const STEP_TITLES = ["Tu hogar", "Integrantes", "¿Cuál sos vos?"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    control,
    trigger,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      householdName: "",
      timezone: "America/Montevideo",
      members: [
        {
          name: "",
          nickname: "",
          role: "PADRE",
          isMinor: false,
          color: PRESET_COLORS[0],
          birthdate: "",
          email: "",
          whatsappPhone: "",
          schoolName: "",
        },
      ],
      selfIndex: undefined,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "members" });
  const watchedMembers = watch("members");
  const watchedSelfIndex = watch("selfIndex");

  async function goToStep1() {
    const ok = await trigger(["householdName", "timezone"]);
    if (ok) setStep(1);
  }

  async function goToStep2() {
    const ok = await trigger("members");
    if (ok) {
      setValue("selfIndex", undefined as unknown as number);
      setStep(2);
    }
  }

  async function onSubmit(data: SetupFormValues) {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        setServerError(typeof body.error === "string" ? body.error : "Error al crear el hogar");
        return;
      }
      router.replace("/");
    } catch {
      setServerError("Error de red, intentá de nuevo");
    }
  }

  const adults = watchedMembers
    .map((m, i) => ({ ...m, originalIndex: i }))
    .filter((m) => !m.isMinor);

  const StepIcon = STEP_ICONS[step];

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-6">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2">
          {STEP_TITLES.map((_, i) => {
            const Icon = STEP_ICONS[i];
            return (
              <div key={i} className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                    i === step
                      ? "bg-blue-600 text-white"
                      : i < step
                        ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40"
                        : "bg-gray-100 text-gray-400 dark:bg-gray-800"
                  }`}
                >
                  <Icon size={14} />
                </div>
                {i < STEP_TITLES.length - 1 && (
                  <div
                    className={`h-px w-8 ${i < step ? "bg-blue-300" : "bg-gray-200 dark:bg-gray-700"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/40">
                <StepIcon size={20} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {STEP_TITLES[step]}
                </h2>
                <p className="text-xs text-gray-400">Paso {step + 1} de 3</p>
              </div>
            </div>

            {/* ── Step 0: Household ── */}
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Nombre del hogar
                  </label>
                  <input
                    {...register("householdName")}
                    type="text"
                    placeholder="Ej: Familia García"
                    autoFocus
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                  {errors.householdName && (
                    <p className="mt-1 text-xs text-red-500">{errors.householdName.message}</p>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Zona horaria
                  </label>
                  <select
                    {...register("timezone")}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  >
                    {TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={goToStep1}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Continuar <ChevronRight size={16} />
                </button>
              </div>
            )}

            {/* ── Step 1: Members ── */}
            {step === 1 && (
              <div className="space-y-4">
                {fields.map((field, i) => (
                  <div
                    key={field.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: watchedMembers[i]?.color }}
                      />
                      <button
                        type="button"
                        onClick={() => remove(i)}
                        disabled={fields.length === 1}
                        className="text-gray-400 hover:text-red-500 disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {/* Name */}
                      <div>
                        <input
                          {...register(`members.${i}.name`)}
                          type="text"
                          placeholder="Nombre *"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                        {errors.members?.[i]?.name && (
                          <p className="mt-0.5 text-xs text-red-500">
                            {errors.members[i]?.name?.message}
                          </p>
                        )}
                      </div>

                      {/* Nickname */}
                      <input
                        {...register(`members.${i}.nickname`)}
                        type="text"
                        placeholder="Apodo (opcional)"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />

                      {/* Role + isMinor */}
                      <div className="flex gap-2">
                        <Controller
                          control={control}
                          name={`members.${i}.role`}
                          render={({ field: f }) => (
                            <select
                              {...f}
                              onChange={(e) => {
                                const role = e.target.value as FamilyRole;
                                f.onChange(role);
                                setValue(`members.${i}.isMinor`, MINOR_ROLES.includes(role));
                              }}
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            >
                              {FAMILY_ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABELS[r]}
                                </option>
                              ))}
                            </select>
                          )}
                        />
                        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <input
                            {...register(`members.${i}.isMinor`)}
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded"
                          />
                          Menor
                        </label>
                      </div>

                      {/* Birthdate */}
                      <input
                        {...register(`members.${i}.birthdate`)}
                        type="date"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      />

                      {/* Email + WhatsApp for adults */}
                      {!watchedMembers[i]?.isMinor && (
                        <>
                          <div>
                            <input
                              {...register(`members.${i}.email`)}
                              type="email"
                              placeholder="Email (opcional)"
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            />
                            {errors.members?.[i]?.email && (
                              <p className="mt-0.5 text-xs text-red-500">
                                {errors.members[i]?.email?.message}
                              </p>
                            )}
                          </div>
                          <input
                            {...register(`members.${i}.whatsappPhone`)}
                            type="tel"
                            placeholder="WhatsApp (opcional, ej: +598 99 123 456)"
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                          />
                        </>
                      )}

                      {/* School for minors */}
                      {watchedMembers[i]?.isMinor && (
                        <input
                          {...register(`members.${i}.schoolName`)}
                          type="text"
                          placeholder="Colegio o escuela (opcional)"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        />
                      )}

                      {/* Color swatches */}
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setValue(`members.${i}.color`, c)}
                            style={{ backgroundColor: c }}
                            className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                              watchedMembers[i]?.color === c
                                ? "ring-2 ring-gray-900 ring-offset-1"
                                : ""
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {errors.members && !Array.isArray(errors.members) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {errors.members.message ?? errors.members.root?.message}
                  </p>
                )}

                <button
                  type="button"
                  onClick={() =>
                    append({
                      name: "",
                      nickname: "",
                      role: "HIJO",
                      isMinor: true,
                      color: PRESET_COLORS[fields.length % PRESET_COLORS.length],
                      birthdate: "",
                      email: "",
                      whatsappPhone: "",
                      schoolName: "",
                    })
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-500 dark:border-gray-600"
                >
                  <PlusCircle size={16} /> Agregar integrante
                </button>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(0)}
                    className="flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                  >
                    <ChevronLeft size={15} /> Volver
                  </button>
                  <button
                    type="button"
                    onClick={goToStep2}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Continuar <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 2: Self ── */}
            {step === 2 && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Hola, {session?.user?.name?.split(" ")[0] ?? ""}. ¿Cuál de estos perfiles sos vos?
                </p>

                <div className="grid gap-2">
                  {adults.map((m) => (
                    <button
                      key={m.originalIndex}
                      type="button"
                      onClick={() =>
                        setValue("selfIndex", m.originalIndex, { shouldValidate: true })
                      }
                      className={`flex items-center gap-3 rounded-xl border-2 p-3 text-left transition-colors ${
                        watchedSelfIndex === m.originalIndex
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                          : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                      }`}
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                        style={{ backgroundColor: m.color }}
                      >
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {m.name}
                        </p>
                        <p className="text-xs text-gray-400">{ROLE_LABELS[m.role]}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {errors.selfIndex && (
                  <p className="text-xs text-red-500">{errors.selfIndex.message}</p>
                )}

                {serverError && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                    {serverError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex items-center gap-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400"
                  >
                    <ChevronLeft size={15} /> Volver
                  </button>
                  <button
                    type="submit"
                    disabled={watchedSelfIndex === undefined || isSubmitting}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    {isSubmitting ? "Creando hogar…" : "Listo, crear hogar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
