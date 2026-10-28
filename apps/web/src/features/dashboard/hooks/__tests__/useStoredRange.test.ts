import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DURATION_RANGE_KEY, HEALTH_RANGE_KEY, useStoredRange } from "../useStoredRange";

const KEY = "vaultly:dashboard:test-range";

describe("useStoredRange", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("names one key per card", () => {
    expect(DURATION_RANGE_KEY).toBe("vaultly:dashboard:duration-range");
    expect(HEALTH_RANGE_KEY).toBe("vaultly:dashboard:health-range");
  });

  it("opens on 30 days when nothing is stored", () => {
    const { result } = renderHook(() => useStoredRange(KEY));

    expect(result.current[0]).toBe(30);
  });

  it.each([7, 30, 90])("restores a stored %i", (days) => {
    localStorage.setItem(KEY, String(days));

    const { result } = renderHook(() => useStoredRange(KEY));

    expect(result.current[0]).toBe(days);
  });

  it.each(["15", "abc", "", " 7", "90.0", "-30"])("ignores a stored %j and opens on 30 days", (stored) => {
    localStorage.setItem(KEY, stored);

    const { result } = renderHook(() => useStoredRange(KEY));

    expect(result.current[0]).toBe(30);
  });

  it("stores the range it is set to", () => {
    const { result } = renderHook(() => useStoredRange(KEY));

    act(() => result.current[1](90));

    expect(result.current[0]).toBe(90);
    expect(localStorage.getItem(KEY)).toBe("90");
  });

  it("writes nothing until a range is picked", () => {
    renderHook(() => useStoredRange(KEY));

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reads the storage once, not on every render", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { rerender } = renderHook(() => useStoredRange(KEY));

    rerender();
    rerender();

    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("keeps working when the storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const { result } = renderHook(() => useStoredRange(KEY));
    expect(result.current[0]).toBe(30);

    act(() => result.current[1](7));

    expect(result.current[0]).toBe(7);
  });

  it("keeps a range per key", () => {
    const duration = renderHook(() => useStoredRange(DURATION_RANGE_KEY));
    const health = renderHook(() => useStoredRange(HEALTH_RANGE_KEY));

    act(() => duration.result.current[1](7));
    act(() => health.result.current[1](90));

    expect(localStorage.getItem(DURATION_RANGE_KEY)).toBe("7");
    expect(localStorage.getItem(HEALTH_RANGE_KEY)).toBe("90");
    expect(duration.result.current[0]).toBe(7);
    expect(health.result.current[0]).toBe(90);
  });
});
