"use client";

import { authUserViewSchema, type AuthUserView } from "@antretix/shared";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";
import { api, TOKEN_KEY, writeToken } from "./api";
import { useStorageItem } from "./storage";

interface AuthContextValue {
  user: AuthUserView | null;
  ready: boolean;
  signIn: (token: string, user: AuthUserView) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const meResponse = z.object({ user: authUserViewSchema });

interface LoadedUser {
  token: string;
  user: AuthUserView;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = useStorageItem("local", TOKEN_KEY);
  const [loaded, setLoaded] = useState<LoadedUser | null>(null);

  useEffect(() => {
    if (token === undefined || token === null || loaded?.token === token) {
      return;
    }

    api("/auth/me", meResponse)
      .then((response) => setLoaded({ token, user: response.user }))
      .catch(() => writeToken(null));
  }, [token, loaded]);

  // Pengguna hanya dianggap login bila profilnya dimuat untuk token yang sedang tersimpan.
  const user =
    token !== undefined && token !== null && loaded?.token === token ? loaded.user : null;

  const ready = token === null || (token !== undefined && loaded?.token === token);

  const signIn = useCallback((nextToken: string, nextUser: AuthUserView) => {
    setLoaded({ token: nextToken, user: nextUser });
    writeToken(nextToken);
  }, []);

  const signOut = useCallback(() => {
    writeToken(null);
    setLoaded(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (value === null) {
    throw new Error("useAuth harus dipakai di dalam AuthProvider");
  }

  return value;
}

/** Mengarahkan ke halaman login (dengan tujuan kembali) bila belum login. */
export function useRequireAuth(): AuthUserView | null {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && user === null) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }, [ready, user, router]);

  return user;
}
