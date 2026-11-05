import { AxiosError, type AxiosAdapter } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
vi.mock("../auth-client", () => ({ authClient: { signOut: (...args: unknown[]) => signOut(...args) } }));

import apiClient from "../api-client";
import { clearSessionRejected, isSessionRejected } from "../session-rejected";

function respondWith(status: number): AxiosAdapter {
  return (config) => {
    const response = { data: {}, status, statusText: "", headers: {}, config };
    return status < 400
      ? Promise.resolve(response)
      : Promise.reject(new AxiosError("failed", String(status), config, null, response));
  };
}

describe("api client session expiry", () => {
  const assign = vi.fn();

  beforeEach(() => {
    signOut.mockReset().mockResolvedValue({ error: null });
    assign.mockReset();
    vi.stubGlobal("location", { pathname: "/connections", assign });
    clearSessionRejected();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ends the session and sends the visitor to the login on a 401", async () => {
    apiClient.defaults.adapter = respondWith(401);

    await expect(apiClient.get("/connections")).rejects.toMatchObject({ response: { status: 401 } });

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(isSessionRejected()).toBe(false);
  });

  it("notes the rejection when the server refuses to end the session", async () => {
    signOut.mockResolvedValue({ error: { status: 429 } });
    apiClient.defaults.adapter = respondWith(401);

    await expect(apiClient.get("/connections")).rejects.toBeDefined();

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(isSessionRejected()).toBe(true);
  });

  it("ends the session once when several requests fail together", async () => {
    apiClient.defaults.adapter = respondWith(401);

    await Promise.allSettled([apiClient.get("/a"), apiClient.get("/b"), apiClient.get("/c")]);

    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("leaves other failures alone", async () => {
    apiClient.defaults.adapter = respondWith(500);

    await expect(apiClient.get("/connections")).rejects.toBeDefined();

    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("does nothing on the login page, where a 401 is a wrong password", async () => {
    vi.stubGlobal("location", { pathname: "/login", assign });
    apiClient.defaults.adapter = respondWith(401);

    await expect(apiClient.get("/anything")).rejects.toBeDefined();

    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
