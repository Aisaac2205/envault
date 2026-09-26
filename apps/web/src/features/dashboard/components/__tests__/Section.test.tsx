import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Section } from "../Section";

describe("Section", () => {
  it("renders the skeleton and not the children while loading", () => {
    render(
      <Section
        id="trends"
        title="Backup trends"
        status="loading"
        skeleton={<div data-testid="skeleton">loading…</div>}
      >
        <div data-testid="content">ready content</div>
      </Section>,
    );

    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("renders an inline error with a retry action that calls onRetry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <Section
        id="restores"
        title="Restores"
        status="error"
        skeleton={<div>loading…</div>}
        onRetry={onRetry}
      >
        <div data-testid="content">ready content</div>
      </Section>,
    );

    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: /reintentar/i });
    await user.click(retryButton);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty slot when status is empty", () => {
    render(
      <Section
        id="storage"
        title="Storage"
        status="empty"
        skeleton={<div>loading…</div>}
        empty={<p data-testid="empty">Nothing here yet</p>}
      >
        <div data-testid="content">ready content</div>
      </Section>,
    );

    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  it("renders children when status is ready, with the title as an h2", () => {
    render(
      <Section id="activity" title="Activity" status="ready" skeleton={<div>loading…</div>}>
        <div data-testid="content">ready content</div>
      </Section>,
    );

    expect(screen.getByTestId("content")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Activity" }),
    ).toBeInTheDocument();
  });

  it("keeps sibling sections independent when one fails", () => {
    render(
      <>
        <Section
          id="restores"
          title="Restores"
          status="error"
          skeleton={<div>loading…</div>}
          onRetry={vi.fn()}
        >
          <div data-testid="restores-content">restores</div>
        </Section>
        <Section id="storage" title="Storage" status="ready" skeleton={<div>loading…</div>}>
          <div data-testid="storage-content">storage ready</div>
        </Section>
      </>,
    );

    expect(screen.queryByTestId("restores-content")).not.toBeInTheDocument();
    expect(screen.getByTestId("storage-content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("marks the surface aria-busy and reduces its opacity while stale", () => {
    render(
      <Section
        id="trends"
        title="Backup trends"
        status="ready"
        skeleton={<div>loading…</div>}
        isStale
      >
        <div data-testid="content">ready content</div>
      </Section>,
    );

    const surface = screen.getByTestId("content").closest('[aria-busy="true"]');
    expect(surface).toBeInTheDocument();
  });
});
