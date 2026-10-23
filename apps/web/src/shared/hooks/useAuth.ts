import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import { PERMISSIONS_QUERY_KEY } from "../lib/permissions-query-key";
import { clearSessionRejected, markSessionRejected } from "../lib/session-rejected";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface UseAuthReturn {
  user: AuthUser | null;
  /** Id of the current session; changes on every sign-in, even for the same user. */
  sessionId: string | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const login = useCallback(() => {
    navigate("/login");
  }, [navigate]);

  // Never rejects: whatever the server says, this browser is done with the
  // session, so callers have nothing to handle.
  const logout = useCallback(async () => {
    let signedOut = false;
    try {
      const result = await authClient.signOut();
      signedOut = !result?.error;
    } catch {
      // Network failure: treated like a refusal, below.
    }

    // The next person to sign in must never start from this one's permissions.
    queryClient.removeQueries({ queryKey: PERMISSIONS_QUERY_KEY });

    if (signedOut) {
      clearSessionRejected();
    } else {
      // The server kept the session (the request failed or was refused, for
      // example with a 429) and this browser's copy of it is still in memory.
      // Without a note, the login screen would send the visitor straight back
      // into the app, which would end the session again, and so on.
      markSessionRejected();
    }
    navigate("/login");
  }, [navigate, queryClient]);

  const user: AuthUser | null = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user.role as string) ?? "user",
      }
    : null;

  return {
    user,
    sessionId: session?.session?.id ?? null,
    isAuthenticated: !!session?.user,
    isInitializing: isPending,
    login,
    logout,
  };
}
