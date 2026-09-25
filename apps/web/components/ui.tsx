import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type Tone = "primary" | "secondary" | "quiet" | "danger";

const toneClass: Record<Tone, string> = {
  // Aksen merah stempel hanya untuk aksi utama di setiap layar.
  primary: "bg-stamp text-stamp-ink hover:brightness-110 disabled:opacity-50",
  secondary: "border border-ink text-ink hover:bg-paper-2 disabled:opacity-50",
  quiet: "text-ink-2 underline underline-offset-4 hover:text-ink disabled:opacity-50",
  danger: "border border-danger text-danger hover:bg-paper-2 disabled:opacity-50",
};

export function Button({
  tone = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  const padding = tone === "quiet" ? "px-1 py-1" : "px-5 py-3";

  return (
    <button
      className={`${padding} rounded-sm text-base font-semibold transition-[filter,background-color] disabled:cursor-not-allowed ${toneClass[tone]} ${className}`}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  tone = "primary",
  children,
}: {
  href: string;
  tone?: Tone;
  children: ReactNode;
}) {
  const padding = tone === "quiet" ? "px-1 py-1" : "px-5 py-3";

  return (
    <Link
      href={href}
      className={`${padding} inline-block rounded-sm text-base font-semibold ${toneClass[tone]}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      <input
        className="w-full rounded-sm border border-rule bg-paper px-3 py-2.5 text-base text-ink placeholder:text-ink-2/70"
        {...props}
      />
      {hint === undefined ? null : <span className="mt-1 block text-sm text-ink-2">{hint}</span>}
    </label>
  );
}

type NoticeTone = "info" | "error" | "ok" | "warn";

const noticeClass: Record<NoticeTone, string> = {
  info: "border-rule text-ink",
  error: "border-danger text-danger",
  ok: "border-ok text-ok",
  warn: "border-warn text-warn",
};

export function Notice({ tone = "info", children }: { tone?: NoticeTone; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-sm border px-4 py-3 text-sm ${noticeClass[tone]}`}
    >
      {children}
    </div>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-8">
      <h1
        className="text-3xl leading-tight font-extrabold tracking-tight sm:text-4xl"
        style={{ fontStretch: "112%" }}
      >
        {children}
      </h1>
      {sub === undefined ? null : <p className="mt-2 max-w-prose text-ink-2">{sub}</p>}
    </header>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="py-12 text-ink-2">Memuat {what}…</p>;
}
