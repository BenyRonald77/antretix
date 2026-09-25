"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";

interface TurnstileApi {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      theme: "auto";
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Widget Cloudflare Turnstile. Token diverifikasi di server saat join antrean. */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null);
  // Script bisa sudah dimuat oleh halaman sebelumnya (navigasi sisi klien).
  const [scriptReady, setScriptReady] = useState(() => globalThis.window?.turnstile !== undefined);

  useEffect(() => {
    const api = window.turnstile;

    if (!scriptReady || api === undefined || container.current === null) {
      return;
    }

    const widgetId = api.render(container.current, {
      sitekey: SITE_KEY,
      callback: (token) => onToken(token),
      "expired-callback": () => onToken(null),
      theme: "auto",
    });

    return () => api.remove(widgetId);
  }, [scriptReady, onToken]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onReady={() => setScriptReady(true)}
      />
      <div ref={container} className="min-h-[65px]" />
    </>
  );
}
