"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Loader2 } from "lucide-react";

// ── Zod schemas ──────────────────────────────────────────────────────────────

const gmailSchema = z.object({
  type: z.literal("GMAIL_LABEL"),
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  label: z
    .string()
    .min(1, "El label de Gmail es obligatorio")
    .regex(/^[^\s]+$/, "El label no puede contener espacios"),
  memberId: z.string().optional(),
  enabled: z.boolean(),
});

const webpageSchema = z.object({
  type: z.literal("WEBPAGE"),
  name: z.string().min(1, "El nombre es obligatorio").max(100),
  url: z.string().url("Debe ser una URL válida"),
  memberId: z.string().optional(),
  enabled: z.boolean(),
});

const formSchema = z.discriminatedUnion("type", [gmailSchema, webpageSchema]);

export type WatchedSourceFormValues = z.infer<typeof formSchema>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WatchedSourceMember {
  id: string;
  name: string;
  nickname: string | null;
  color: string | null;
}

export interface WatchedSourceFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  members: WatchedSourceMember[];
  /** When provided the form is in edit mode */
  initialValues?: {
    id: string;
    type: "GMAIL_LABEL" | "WEBPAGE";
    name: string;
    config: Record<string, unknown>;
    memberId: string | null;
    enabled: boolean;
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WatchedSourceForm({
  isOpen,
  onClose,
  onSaved,
  members,
  initialValues,
}: WatchedSourceFormProps) {
  const isEditing = !!initialValues;

  const defaultValues = (): WatchedSourceFormValues => {
    if (initialValues) {
      if (initialValues.type === "GMAIL_LABEL") {
        return {
          type: "GMAIL_LABEL",
          name: initialValues.name,
          label: (initialValues.config.label as string) ?? "",
          memberId: initialValues.memberId ?? "",
          enabled: initialValues.enabled,
        };
      }
      return {
        type: "WEBPAGE",
        name: initialValues.name,
        url: (initialValues.config.url as string) ?? "",
        memberId: initialValues.memberId ?? "",
        enabled: initialValues.enabled,
      };
    }
    return { type: "GMAIL_LABEL", name: "", label: "", memberId: "", enabled: true };
  };

  const {
    register,
    handleSubmit,
    watch,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<WatchedSourceFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValues(),
  });

  // Reset the form whenever the modal opens with new data
  useEffect(() => {
    if (isOpen) reset(defaultValues());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialValues]);

  const selectedType = watch("type");

  const onSubmit = async (values: WatchedSourceFormValues) => {
    const config = values.type === "GMAIL_LABEL" ? { label: values.label } : { url: values.url };

    const payload = {
      type: values.type,
      name: values.name,
      config,
      memberId: values.memberId || null,
      enabled: values.enabled,
    };

    const url = isEditing ? "/api/watched-sources" : "/api/watched-sources";
    const method = isEditing ? "PATCH" : "POST";
    const body = isEditing
      ? JSON.stringify({ id: initialValues!.id, ...payload })
      : JSON.stringify(payload);

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      alert(data.error ?? "Error al guardar");
      return;
    }

    onSaved();
  };

  if (!isOpen) return null;

  const inputClass =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500/40 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100";
  const errorClass = "mt-1 text-xs text-red-500 dark:text-red-400";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300";

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {isEditing ? "Editar fuente" : "Nueva fuente externa"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 p-4">
          {/* Tipo */}
          <div>
            <label className={labelClass}>Tipo de fuente</label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <div className="mt-1 flex gap-3">
                  {(["GMAIL_LABEL", "WEBPAGE"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => field.onChange(t)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        field.value === t
                          ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/30 dark:text-blue-300"
                          : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {t === "GMAIL_LABEL" ? "📧 Gmail Label" : "🌐 Página Web"}
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {/* Nombre */}
          <div>
            <label htmlFor="ws-name" className={labelClass}>
              Nombre descriptivo
            </label>
            <input
              id="ws-name"
              {...register("name")}
              placeholder={
                selectedType === "GMAIL_LABEL" ? "Colegio de Violeta" : "Web del colegio — eventos"
              }
              className={`mt-1 ${inputClass}`}
            />
            {errors.name && <p className={errorClass}>{errors.name.message}</p>}
          </div>

          {/* Campo específico por tipo */}
          {selectedType === "GMAIL_LABEL" && (
            <div>
              <label htmlFor="ws-label" className={labelClass}>
                Label de Gmail
              </label>
              <input
                id="ws-label"
                {...register("label" as never)}
                placeholder="colegio"
                className={`mt-1 ${inputClass}`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Nombre exacto de la etiqueta en Gmail (sin espacios). Ej:{" "}
                <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">colegio</code>,{" "}
                <code className="rounded bg-gray-100 px-1 dark:bg-gray-700">INBOX</code>
              </p>
              {"label" in errors && errors.label && (
                <p className={errorClass}>
                  {(errors as { label?: { message?: string } }).label?.message}
                </p>
              )}
            </div>
          )}

          {selectedType === "WEBPAGE" && (
            <div>
              <label htmlFor="ws-url" className={labelClass}>
                URL de la página
              </label>
              <input
                id="ws-url"
                type="url"
                {...register("url" as never)}
                placeholder="https://www.colegio.edu.uy/eventos"
                className={`mt-1 ${inputClass}`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                El scraper visitará esta URL una vez por día y extraerá eventos con fecha.
              </p>
              {"url" in errors && errors.url && (
                <p className={errorClass}>
                  {(errors as { url?: { message?: string } }).url?.message}
                </p>
              )}
            </div>
          )}

          {/* Miembro */}
          <div>
            <label htmlFor="ws-member" className={labelClass}>
              Destinatario (opcional)
            </label>
            <select id="ws-member" {...register("memberId")} className={`mt-1 ${inputClass}`}>
              <option value="">— Hogar en general —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.nickname ? ` (${m.nickname})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Habilitada */}
          <div className="flex items-center gap-3">
            <Controller
              name="enabled"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
                    field.value ? "bg-blue-600" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      field.value ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              )}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Habilitada</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 size={14} className="animate-spin" />}
              {isEditing ? "Guardar cambios" : "Crear fuente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
