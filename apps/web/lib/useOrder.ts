"use client";

import { orderViewSchema, type OrderView } from "@antretix/shared";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { api } from "./api";
import { syncServerClock } from "./clock";

const orderResponse = z.object({ order: orderViewSchema });

export interface OrderState {
  order: OrderView | null;
  error: string | null;
  reload: () => void;
}

export function useOrder(orderId: string, enabled: boolean, pollMs: number | null): OrderState {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api(`/orders/${orderId}`, orderResponse)
      .then((response) => {
        syncServerClock(response.order.serverTime);
        setOrder(response.order);
        setError(null);
      })
      .catch((cause: Error) => setError(cause.message));
  }, [orderId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    reload();

    if (pollMs === null) {
      return;
    }

    const timer = setInterval(reload, pollMs);

    return () => clearInterval(timer);
  }, [enabled, reload, pollMs]);

  return { order, error, reload };
}
