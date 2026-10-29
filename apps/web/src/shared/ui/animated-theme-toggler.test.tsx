import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnimatedThemeToggler } from "./animated-theme-toggler";
import { __internalReset } from "@/shared/hooks/useTheme";

beforeEach(() => {
  localStorage.removeItem("vaultly:theme");
  __internalReset();
});

// jsdom ignores CSS, so these pin the class contract the browser renders.
describe("AnimatedThemeToggler keyboard focus", () => {
  it("shows the same focus ring as the header buttons beside it", () => {
    render(<AnimatedThemeToggler sound={false} />);
    const button = screen.getByRole("button", { name: "Toggle theme" });

    expect(button).toHaveClass("focus-visible:ring-2", "focus-visible:ring-sidebar-indicator");
    // An inline `outline: none` would also hide the forced-colors outline; the class keeps it.
    expect(button.style.outline).toBe("");
    expect(button).toHaveClass("focus-visible:outline-hidden");
  });

  it("keeps the classes a caller adds, such as the phone touch target", () => {
    render(<AnimatedThemeToggler sound={false} className="relative after:absolute after:-inset-y-1.5" />);
    const button = screen.getByRole("button", { name: "Toggle theme" });

    expect(button).toHaveClass("relative", "after:absolute", "after:-inset-y-1.5", "focus-visible:ring-2");
  });
});
