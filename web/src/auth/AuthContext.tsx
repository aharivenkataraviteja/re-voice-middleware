import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, setAccessToken, setUnauthorizedHandler, ApiError } from "../api/client";
import type { Me, Role } from "../api/types";

interface AuthState {
  status: "loading" | "authenticated" | "unauthenticated";
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);

  async function loadMe() {
    const result = await api.get<Me>("/api/v1/auth/me");
    setMe(result);
    setStatus("authenticated");
  }

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      setMe(null);
      setStatus("unauthenticated");
    });

    // Silent refresh on load: the access token only lives in memory and is
    // gone after a full page reload, but the httpOnly refresh cookie
    // survives — use it to get a new access token without asking the user
    // to log in again every time they refresh the page.
    (async () => {
      const refreshed = await api.tryRefresh();
      if (refreshed) {
        try {
          await loadMe();
          return;
        } catch {
          /* fall through to unauthenticated */
        }
      }
      setStatus("unauthenticated");
    })();
  }, []);

  async function login(email: string, password: string) {
    const result = await api.post<{ accessToken: string; role: Role }>("/api/v1/auth/login", {
      email,
      password,
    });
    setAccessToken(result.accessToken);
    await loadMe();
  }

  async function logout() {
    try {
      await api.post("/api/v1/auth/logout");
    } catch {
      /* logout should always succeed client-side even if the request fails */
    }
    setAccessToken(null);
    setMe(null);
    setStatus("unauthenticated");
  }

  return <AuthContext.Provider value={{ status, me, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
