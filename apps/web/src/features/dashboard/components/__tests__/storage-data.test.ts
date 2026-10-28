import { describe, expect, it } from "vitest";
import type { ConnectionStorage } from "../../types";
import {
  formatShare,
  OTHER_COLOR,
  SLICE_COLORS,
  toStorageSlices,
} from "../storage-by-connection/storage-data";

/** The Spanish strings, with the same singular/plural split as `storage.other_one` and `storage.other_other`. */
const LABELS = {
  deleted: "Conexión eliminada",
  other: (count: number) => (count === 1 ? `${count} otra` : `${count} otras`),
};

function row(id: string, name: string | null, sizeMb: number, count = 1): ConnectionStorage {
  return { connectionId: id, connectionName: name, totalSizeMb: sizeMb, backupCount: count };
}

describe("toStorageSlices", () => {
  it("keeps up to three connections as slices, in the order they come", () => {
    const slices = toStorageSlices(
      [row("a", "Shop", 300), row("b", "CRM", 200), row("c", "Blog", 100)],
      LABELS,
    );

    expect(slices.map((slice) => slice.label)).toEqual(["Shop", "CRM", "Blog"]);
    expect(slices.map((slice) => slice.value)).toEqual([300, 200, 100]);
    expect(slices.some((slice) => slice.isOther)).toBe(false);
  });

  it("colors the three largest with the categorical tokens, in order", () => {
    const slices = toStorageSlices(
      [row("a", "Shop", 300), row("b", "CRM", 200), row("c", "Blog", 100)],
      LABELS,
    );

    expect(SLICE_COLORS).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
    expect(slices.map((slice) => slice.color)).toEqual([...SLICE_COLORS]);
  });

  it("folds everything past the third into one neutral Other slice", () => {
    const slices = toStorageSlices(
      [
        row("a", "Shop", 500, 10),
        row("b", "CRM", 400, 8),
        row("c", "Blog", 300, 6),
        row("d", "Wiki", 90, 3),
        row("e", "Forum", 10, 1),
      ],
      LABELS,
    );

    expect(slices).toHaveLength(4);
    expect(slices[3]).toMatchObject({
      id: "other",
      label: "2 otras",
      value: 100,
      backupCount: 4,
      color: OTHER_COLOR,
      isOther: true,
    });
    expect(OTHER_COLOR).toBe("var(--chart-4)");
  });

  it("folds a single leftover connection under the singular label", () => {
    const slices = toStorageSlices(
      [row("a", "Shop", 500), row("b", "CRM", 400), row("c", "Blog", 300), row("d", "Wiki", 90, 3)],
      LABELS,
    );

    expect(slices).toHaveLength(4);
    expect(slices[3]).toMatchObject({ id: "other", label: "1 otra", value: 90, backupCount: 3, isOther: true });
  });

  it("does not change the total when it folds", () => {
    const rows = [
      row("a", "Shop", 500),
      row("b", "CRM", 400),
      row("c", "Blog", 300),
      row("d", "Wiki", 90),
    ];

    const slices = toStorageSlices(rows, LABELS);

    const total = (list: { value: number }[]) => list.reduce((sum, item) => sum + item.value, 0);
    expect(total(slices)).toBe(total(rows.map((r) => ({ value: r.totalSizeMb }))));
  });

  it("names a connection that was deleted instead of showing a blank", () => {
    const slices = toStorageSlices([row("a", null, 300), row("b", "", 200)], LABELS);

    expect(slices.map((slice) => slice.label)).toEqual(["Conexión eliminada", "Conexión eliminada"]);
    // Two deleted connections stay two slices: they are told apart by id.
    expect(new Set(slices.map((slice) => slice.id)).size).toBe(2);
  });

  it("sorts by size, so the top three are right even if the API order changes", () => {
    const slices = toStorageSlices(
      [row("c", "Blog", 100), row("a", "Shop", 300), row("b", "CRM", 200)],
      LABELS,
    );

    expect(slices.map((slice) => slice.label)).toEqual(["Shop", "CRM", "Blog"]);
  });

  it("drops connections with nothing stored", () => {
    const slices = toStorageSlices([row("a", "Shop", 300), row("b", "Empty", 0)], LABELS);

    expect(slices.map((slice) => slice.label)).toEqual(["Shop"]);
  });

  it("returns no slices when nothing is stored", () => {
    expect(toStorageSlices([], LABELS)).toEqual([]);
    expect(toStorageSlices([row("a", "Shop", 0)], LABELS)).toEqual([]);
  });
});

describe("formatShare", () => {
  it("is the part over the total, rounded to a whole percent", () => {
    expect(formatShare(300, 1000, "en-US")).toBe("30%");
    expect(formatShare(1, 3, "en-US")).toBe("33%");
  });

  it("shows less than one percent as such, not 0%", () => {
    expect(formatShare(2, 1000, "en-US")).toBe("<1%");
  });

  it("is an em dash for an empty total", () => {
    expect(formatShare(0, 0, "en-US")).toBe("—");
  });
});
