"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, tokenStore, setUnauthorizedHandler, ApiError } from "@/lib/api";
import type { User, Organization } from "@/lib/types";

interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  user: User | null;
  organizations: Organization[];
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { email: string; password: string; name: string; organizationName?: string }) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    status: "loading",
    user: null,
    organizations: [],
  });

  const loadMe = useCallback(async () => {
    if (!tokenStore.access) {
      setState({ status: "unauthenticated", user: null, organizations: [] });
      return;
    }
    try {
      const me = await api.me();
      setState({ status: "authenticated", user: me.user, organizations: me.organizations });
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        tokenStore.clear();
      }
      setState({ status: "unauthenticated", user: null, organizations: [] });
    }
  }, []);

  // Redirect to login when a refresh ultimately fails mid-session.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setState({ status: "unauthenticated", user: null, organizations: [] });
      router.replace("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      tokenStore.set(res.accessToken, res.refreshToken);
      await loadMe();
    },
    [loadMe],
  );

  const signup = useCallback(
    async (input: { email: string; password: string; name: string; organizationName?: string }) => {
      const res = await api.signup(input);
      tokenStore.set(res.accessToken, res.refreshToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(() => {
    void api.logout().catch(() => {});
    tokenStore.clear();
    setState({ status: "unauthenticated", user: null, organizations: [] });
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, logout, refreshMe: loadMe }),
    [state, login, signup, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
