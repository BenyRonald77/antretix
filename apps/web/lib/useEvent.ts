"use client";

import { eventViewSchema, type EventView } from "@antretix/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { syncServerClock } from "./clock";

export interface EventState {
  event: EventView | null;
  error: string | null;
  reload: () => void;
}

export function useEvent(eventId: string): EventState {
  const [event, setEvent] = useState<EventView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api(`/events/${eventId}`, eventViewSchema)
      .then((next) => {
        syncServerClock(next.serverTime);
        setEvent(next);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [eventId]);

  useEffect(reload, [reload]);

  return { event, error, reload };
}
