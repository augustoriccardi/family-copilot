"use client";

import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import { EventClickArg, DatesSetArg } from "@fullcalendar/core";
import { X, MapPin, User, Users, ExternalLink, Calendar } from "lucide-react";

interface CalendarMember {
  id: string;
  name: string;
  color: string | null;
}

interface CalendarParticipant extends CalendarMember {
  role: string;
  rsvp: string;
}

interface FCEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  extendedProps: {
    description?: string;
    location?: string;
    eventType: string;
    status: string;
    member?: CalendarMember | null;
    responsible?: CalendarMember | null;
    participants: CalendarParticipant[];
    externalEventId?: string | null;
    googleCalendarId?: string | null;
    notes?: string | null;
    sourceType?: string | null;
    sourceNotes?: string | null;
    sourceFileUrl?: string | null;
  };
}

const SOURCE_LABELS: Record<string, { label: string; emoji: string }> = {
  email: { label: "Email", emoji: "📧" },
  pdf: { label: "PDF", emoji: "📄" },
  image: { label: "Imagen", emoji: "🖼" },
  whatsapp: { label: "WhatsApp", emoji: "💬" },
  web: { label: "Web", emoji: "🌐" },
  manual: { label: "Manual", emoji: "✏️" },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  FAMILY: "Familiar",
  PERSONAL: "Personal",
  MEDICAL: "Médico",
  SCHOOL: "Escolar",
  ACTIVITY: "Actividad",
  WORK: "Trabajo",
  OTHER: "Otro",
};

export function CalendarView() {
  const calendarRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<FCEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<FCEvent | null>(null);

  const fetchEvents = async (start: string, end: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    fetchEvents(arg.startStr, arg.endStr);
  };

  const handleEventClick = (arg: EventClickArg) => {
    const ev = events.find((e) => e.id === arg.event.id);
    if (ev) setSelectedEvent(ev);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Loading bar */}
      {loading && (
        <div className="absolute top-0 left-0 z-20 h-0.5 w-full">
          <div className="h-full animate-pulse bg-indigo-400" />
        </div>
      )}

      {/* FullCalendar */}
      <div className="fc-family min-h-0 flex-1 overflow-auto p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          locale="es"
          buttonText={{
            today: "hoy",
            month: "mes",
            week: "semana",
            day: "día",
          }}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay",
          }}
          events={events}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          height="100%"
          eventDisplay="block"
          dayMaxEvents={3}
          nowIndicator
        />
      </div>

      {/* Event detail modal */}
      {selectedEvent && <EventModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}

function buildGoogleCalendarLink(eventId: string, calendarId: string): string {
  // Google Calendar expects eid = base64url("<eventId> <calendarId>")
  const raw = `${eventId} ${calendarId}`;
  const b64 = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `https://calendar.google.com/calendar/event?eid=${b64}`;
}

function EventModal({ event, onClose }: { event: FCEvent; onClose: () => void }) {
  const { extendedProps } = event;

  // Format dates
  const start = new Date(event.start);
  const end = new Date(event.end);
  const formatDate = (d: Date) =>
    d.toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const formatTime = (d: Date) =>
    d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between rounded-t-xl p-5"
          style={{ backgroundColor: event.backgroundColor }}
        >
          <div className="flex-1 pr-3">
            <span className="mb-1 inline-block rounded bg-white/20 px-2 py-0.5 text-xs font-medium text-white">
              {EVENT_TYPE_LABELS[extendedProps.eventType] ?? extendedProps.eventType}
            </span>
            <h2 className="text-lg leading-tight font-semibold text-white">{event.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-5">
          {/* Date & time */}
          <div className="flex items-start gap-2 text-sm text-gray-700">
            <Calendar size={15} className="mt-0.5 shrink-0 text-gray-400" />
            <div>
              <p>{formatDate(start)}</p>
              {!event.allDay && (
                <p className="text-gray-500">
                  {formatTime(start)} – {formatTime(end)}
                </p>
              )}
              {event.allDay && <p className="text-gray-500">Todo el día</p>}
            </div>
          </div>

          {/* Location */}
          {extendedProps.location && (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <MapPin size={15} className="shrink-0 text-gray-400" />
              <span>{extendedProps.location}</span>
            </div>
          )}

          {/* Member */}
          {extendedProps.member && (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <User size={15} className="shrink-0 text-gray-400" />
              <span>
                Para:{" "}
                <span
                  className="font-medium"
                  style={{ color: extendedProps.member.color ?? undefined }}
                >
                  {extendedProps.member.name}
                </span>
              </span>
            </div>
          )}

          {/* Responsible */}
          {extendedProps.responsible && (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <User size={15} className="shrink-0 text-gray-400" />
              <span>
                Responsable:{" "}
                <span
                  className="font-medium"
                  style={{ color: extendedProps.responsible.color ?? undefined }}
                >
                  {extendedProps.responsible.name}
                </span>
              </span>
            </div>
          )}

          {/* Participants */}
          {extendedProps.participants.length > 0 && (
            <div className="flex items-start gap-2 text-sm text-gray-700">
              <Users size={15} className="mt-0.5 shrink-0 text-gray-400" />
              <div className="flex flex-wrap gap-1">
                {extendedProps.participants.map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full px-2 py-0.5 text-xs text-white"
                    style={{ backgroundColor: p.color ?? "#6b7280" }}
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {extendedProps.description && (
            <p className="text-sm leading-snug text-gray-600">{extendedProps.description}</p>
          )}

          {/* Notes */}
          {extendedProps.notes && (
            <p className="text-xs leading-snug text-gray-400 italic">{extendedProps.notes}</p>
          )}

          {/* Source badge — shown when the event was created from inbox */}
          {extendedProps.sourceType && SOURCE_LABELS[extendedProps.sourceType] && (
            <div className="flex items-start gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              <span className="shrink-0 text-base leading-none">
                {SOURCE_LABELS[extendedProps.sourceType].emoji}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium">
                  Detectado desde {SOURCE_LABELS[extendedProps.sourceType].label}
                </span>
                {extendedProps.sourceNotes && (
                  <p className="mt-0.5 text-indigo-500">{extendedProps.sourceNotes}</p>
                )}
                {extendedProps.sourceFileUrl && (
                  <div className="mt-2">
                    {/\.(jpe?g|png|gif|webp)$/i.test(extendedProps.sourceFileUrl) ? (
                      <a
                        href={extendedProps.sourceFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={extendedProps.sourceFileUrl}
                          alt="Fuente"
                          className="max-h-40 rounded border border-indigo-200 object-contain"
                        />
                      </a>
                    ) : extendedProps.sourceFileUrl.includes("mail.google.com") ? (
                      <a
                        href={extendedProps.sourceFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-medium underline hover:text-indigo-900"
                      >
                        <ExternalLink size={11} />
                        Ver correo en Gmail
                      </a>
                    ) : (
                      <a
                        href={extendedProps.sourceFileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-medium underline hover:text-indigo-900"
                      >
                        <ExternalLink size={11} />
                        Ver archivo fuente
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Google Calendar link */}
          {extendedProps.externalEventId && extendedProps.googleCalendarId && (
            <a
              href={buildGoogleCalendarLink(
                extendedProps.externalEventId,
                extendedProps.googleCalendarId,
              )}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-indigo-500 hover:underline"
            >
              <ExternalLink size={12} />
              Ver en Google Calendar
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
