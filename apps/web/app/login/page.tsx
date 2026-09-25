"use client";

import { authUserViewSchema } from "@antretix/shared";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, Field, Notice, PageTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const authResponse = z.object({ token: z.string(), user: authUserViewSchema });

type Mode = "login" | "register";

function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const body =
        mode === "login"
          ? JSON.stringify({ email, password })
          : JSON.stringify({ email, name, password });

      const response = await api(
        mode === "login" ? "/auth/login" : "/auth/register",
        authResponse,
        { method: "POST", body },
      );

      signIn(response.token, response.user);
      // Hanya tujuan internal yang diikuti, bukan URL luar.
      router.replace(next !== null && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gagal masuk");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md">
      <PageTitle sub="Satu akun berarti satu posisi antrean per konser. Membuka tab baru tidak memberi posisi tambahan.">
        {mode === "login" ? "Masuk" : "Buat akun"}
      </PageTitle>
      <form onSubmit={submit} className="space-y-4">
        {mode === "register" ? (
          <Field
            label="Nama"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nama Anda"
            autoComplete="name"
            required
          />
        ) : null}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="email@example.com"
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "register" ? 8 : 1}
          hint={mode === "register" ? "Minimal 8 karakter" : undefined}
          required
        />
        {error === null ? null : <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy}>
            {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
          </Button>
          <Button
            type="button"
            tone="quiet"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
          </Button>
        </div>
      </form>
      <div className="mt-10 border-t border-rule pt-4 text-sm text-ink-2">
        <p className="font-semibold text-ink">Akun demo (dari seed)</p>
        <p>Pembeli: fan@antretix.dev / fan12345</p>
        <p>Admin: admin@antretix.dev / admin12345</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
