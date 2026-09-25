"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth";
import { useStorageItem, writeStorage } from "@/lib/storage";

type Theme = "light" | "dark";

export const THEME_KEY = "antretix.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystemTheme(listener: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);

  media.addEventListener("change", listener);

  return () => media.removeEventListener("change", listener);
}

function ThemeToggle() {
  const stored = useStorageItem("local", THEME_KEY);

  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );

  const theme: Theme =
    stored === "dark" || stored === "light" ? stored : systemDark ? "dark" : "light";

  // Menyelaraskan atribut DOM (sistem eksternal) dengan pilihan tema.
  useEffect(() => {
    if (stored === "dark" || stored === "light") {
      document.documentElement.dataset.theme = stored;
    }
  }, [stored]);

  if (stored === undefined) {
    return <span className="w-24" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={() => writeStorage("local", THEME_KEY, theme === "dark" ? "light" : "dark")}
      className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
    >
      {theme === "dark" ? "Tema terang" : "Tema gelap"}
    </button>
  );
}

export function SiteHeader() {
  const { user, signOut } = useAuth();

  return (
    <header className="border-b border-rule">
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
        <Link
          href="/"
          className="mr-auto text-xl font-black tracking-tight"
          style={{ fontStretch: "125%" }}
        >
          AntreTix
        </Link>
        {user === null ? null : (
          <Link href="/orders" className="text-sm font-semibold hover:underline">
            Tiket saya
          </Link>
        )}
        {user?.role === "ADMIN" ? (
          <Link href="/admin/events" className="text-sm font-semibold hover:underline">
            Admin
          </Link>
        ) : null}
        <ThemeToggle />
        {user === null ? (
          <Link href="/login" className="text-sm font-semibold hover:underline">
            Masuk
          </Link>
        ) : (
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-ink-2 hover:text-ink hover:underline"
          >
            Keluar ({user.name})
          </button>
        )}
      </nav>
    </header>
  );
}
