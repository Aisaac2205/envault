import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Freshness } from "../../types";
import { FreshnessBadge } from "../connections-health/FreshnessBadge";
import { FRESHNESS_META } from "../connections-health/freshness-meta";
import { useEnglishLocale } from "./english-locale";

const STATES: [Freshness, string, string][] = [
  ["ok", "On track", "lucide-circle-check"],
  ["late", "Late", "lucide-clock"],
  ["stale", "Overdue", "lucide-octagon-alert"],
  ["unknown", "No schedule", "lucide-circle-dashed"],
];

describe("FreshnessBadge", () => {
  useEnglishLocale();

  it.each(STATES)("shows %s as an icon and the label %s, so color is never the only signal", (freshness, label, iconClass) => {
    const { container } = render(<FreshnessBadge freshness={freshness} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass(iconClass);
  });

  it("gives each state its own icon shape", () => {
    const icons = Object.values(FRESHNESS_META).map((meta) => meta.icon);

    expect(new Set(icons).size).toBe(icons.length);
  });

  it.each([
    ["ok", "success"],
    ["late", "warning"],
    ["stale", "error"],
  ] as const)("colors %s with the %s token alone: icon, surface and border", (freshness, token) => {
    const { tone } = FRESHNESS_META[freshness];
    const used = new Set(tone.match(/--color-(success|warning|error|info)/g));

    expect(used).toEqual(new Set([`--color-${token}`]));
    expect(tone).toContain(`[&>svg]:text-${token}`);
  });

  it("keeps the unknown state neutral", () => {
    expect(FRESHNESS_META.unknown.tone).not.toMatch(/--color-(success|warning|error|info)|text-(success|warning|error|info)/);
  });

  it("keeps the text in the text token: only the icon, surface and border take the color", () => {
    render(<FreshnessBadge freshness="stale" />);

    const badge = screen.getByText("Overdue");
    expect(badge).toHaveClass("text-text-primary");
    expect(badge.className).not.toMatch(/(^|\s)text-(success|warning|error)(\s|$)/);
  });

  it("follows the active language", async () => {
    const { default: i18n } = await import("@/i18n");
    await i18n.changeLanguage("es");

    render(<FreshnessBadge freshness="stale" />);

    expect(screen.getByText("Vencido")).toBeInTheDocument();
  });
});
