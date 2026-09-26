import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WindowFilter } from "../WindowFilter";

describe("WindowFilter", () => {
  it("renders one radio per window with the 30-day option checked", () => {
    render(<WindowFilter value={30} onChange={vi.fn()} />);

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);

    const checked = radios.find((radio) => (radio as HTMLInputElement).checked);
    expect((checked as HTMLInputElement).value).toBe("30");
  });

  it("calls onChange with the selected window", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WindowFilter value={30} onChange={onChange} />);

    const sevenDayOption = screen.getByRole("radio", { name: /7d/ });
    await user.click(sevenDayOption);

    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("groups the radios under one accessible fieldset", () => {
    render(<WindowFilter value={90} onChange={vi.fn()} />);
    expect(screen.getByRole("group")).toBeInTheDocument();
  });
});
