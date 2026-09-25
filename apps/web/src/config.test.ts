import { describe, expect, it } from "vitest";
import { APP_CONFIG, createAppConfig } from "./config";

describe("createAppConfig", () => {
  it("keeps apiUrl as the bare origin so Better Auth can append its own base path", () => {
    const config = createAppConfig("https://api.example.com");

    expect(config.apiUrl).toBe("https://api.example.com");
  });

  it("appends the global /api prefix for domain endpoints", () => {
    const config = createAppConfig("https://api.example.com");

    expect(config.apiBaseUrl).toBe("https://api.example.com/api");
  });

  it("produces a same-origin relative base when no api url is configured", () => {
    const config = createAppConfig("");

    expect(config.apiUrl).toBe("");
    expect(config.apiBaseUrl).toBe("/api");

    const configUndefined = createAppConfig(undefined);
    expect(configUndefined.apiUrl).toBe("");
    expect(configUndefined.apiBaseUrl).toBe("/api");
  });

  it("does not double the slash when the configured url has a trailing one", () => {
    const config = createAppConfig("https://api.example.com/");

    expect(config.apiBaseUrl).toBe("https://api.example.com/api");
  });

  it("throws loudly instead of silently breaking auth when VITE_API_URL carries a path", () => {
    expect(() => createAppConfig("https://api.example.com/api")).toThrow(
      /bare origin with no path/,
    );
  });

  it("throws loudly when VITE_API_URL is not a valid absolute URL", () => {
    expect(() => createAppConfig("not-a-url")).toThrow(
      /not a valid absolute URL/,
    );
  });

  it("exports APP_CONFIG matching AppConfig contract", () => {
    expect(typeof APP_CONFIG.apiUrl).toBe("string");
    expect(typeof APP_CONFIG.apiBaseUrl).toBe("string");
    expect(APP_CONFIG.apiBaseUrl.endsWith("/api")).toBe(true);
  });
});

