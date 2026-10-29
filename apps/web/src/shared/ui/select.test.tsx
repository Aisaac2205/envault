import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

function renderSelect(valueClassName?: string) {
  render(
    <Select value="orders" onValueChange={() => {}}>
      <SelectTrigger aria-label="Connection">
        <SelectValue className={valueClassName} placeholder="Pick one" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="orders">orders-production-primary-with-a-very-long-name</SelectItem>
      </SelectContent>
    </Select>,
  );
  return document.querySelector('[data-slot="select-value"]') as HTMLElement;
}

// Radix Select.Value discards the className it is given, so a long value never
// truncated. jsdom ignores CSS: this pins the class contract the browser renders.
describe("SelectValue", () => {
  it("truncates a long value: the shrinkable flex item of the trigger carries truncate", () => {
    const value = renderSelect();

    expect(value.parentElement).toHaveAttribute("data-slot", "select-trigger");
    expect(value).toHaveClass("min-w-0", "truncate");
    expect(value).toHaveTextContent("orders-production-primary-with-a-very-long-name");
  });

  it("keeps the classes a caller adds", () => {
    const value = renderSelect("text-xs");

    expect(value).toHaveClass("truncate", "text-xs");
  });
});
