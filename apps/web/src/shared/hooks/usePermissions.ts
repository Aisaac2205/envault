import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import apiClient from "../lib/api-client";
import { PERMISSIONS_QUERY_KEY } from "../lib/permissions-query-key";
import { APP_SECTIONS, type AppSection } from "../lib/sections";
import { useAuth } from "./useAuth";

/** What `GET /me/permissions` answers (after the response envelope is removed). */
export interface PermissionsResponse {
  role: string;
  features: string[];
}

async function fetchPermissions(): Promise<PermissionsResponse> {
  const response = await apiClient.get<PermissionsResponse>("/me/permissions");
  return response.data;
}

function isUnauthorized(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

/** Same budget as the app-wide default, except that a 401 is final: retrying cannot revive a session. */
const MAX_RETRIES = 2;
function shouldRetry(failureCount: number, error: unknown): boolean {
  return !isUnauthorized(error) && failureCount < MAX_RETRIES;
}

type PermissionsStatus = "loading" | "ready" | "error" | "unauthorized";

interface UsePermissionsReturn {
  /**
   * `unauthorized`: the API refused the session itself (401), so the user has
   * to sign in again. `error`: the answer could not be had (server down, or
   * the browser is offline), which says nothing about what the user may see.
   */
  status: PermissionsStatus;
  /** Sections of the sidebar the server granted, in sidebar order. Empty until `ready`. */
  sections: readonly AppSection[];
  /** Path of the first granted section, or `null` when there is none. */
  firstAllowedPath: string | null;
  /** Default-deny: `false` until the server has said otherwise. */
  can: (feature: string) => boolean;
  refetch: () => void;
}

/**
 * The signed-in user's permissions, as decided by the API's permission map.
 * This is the only place the web app learns what a user may see: nothing here
 * or in the components that use it compares roles.
 */
export function usePermissions(): UsePermissionsReturn {
  const { user, sessionId } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // The key carries the user AND the session, so neither another user nor the
  // same user's earlier session ever sees these permissions, not even while the
  // new ones load.
  const query = useQuery({
    queryKey: [...PERMISSIONS_QUERY_KEY, userId, sessionId],
    queryFn: fetchPermissions,
    enabled: userId !== undefined,
    retry: shouldRetry,
  });

  // Entries of other sessions are dead weight and, for a shared browser, stale
  // authority: drop them as soon as the session changes or ends.
  useEffect(() => {
    queryClient.removeQueries({
      queryKey: PERMISSIONS_QUERY_KEY,
      predicate: (cached) => cached.queryKey[1] !== userId || cached.queryKey[2] !== sessionId,
    });
  }, [queryClient, userId, sessionId]);

  let status: PermissionsStatus = "loading";
  if (query.isError && isUnauthorized(query.error)) {
    // Checked before the cache: a revoked session must not keep the answer it
    // was given while it was valid, whichever refetch noticed the revocation.
    status = "unauthorized";
  } else if (query.data) {
    status = "ready";
  } else if (query.isError) {
    status = "error";
  } else if (query.fetchStatus === "paused") {
    // Offline: the request is waiting for the network. Say so instead of
    // spinning, and let the query resume by itself when the browser is back.
    status = "error";
  }

  const granted = status === "ready" ? query.data?.features : undefined;

  const sections = useMemo(
    () => (granted ? APP_SECTIONS.filter((section) => granted.includes(section.feature)) : []),
    [granted],
  );

  const can = useCallback(
    (feature: string) => granted?.includes(feature) ?? false,
    [granted],
  );

  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    status,
    sections,
    firstAllowedPath: sections[0]?.path ?? null,
    can,
    refetch: retry,
  };
}
