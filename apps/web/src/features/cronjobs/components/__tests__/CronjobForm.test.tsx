import type { ComponentProps } from "react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import i18n from "@/i18n";
import CronjobForm from "../CronjobForm";
import type { Connection, Cronjob, Schedule } from "../../types";

const connections: Connection[] = [
  { id: "conn-1", name: "Prod DB", slug: "prod-db", environment: "prod" },
];

// The web ignores whatever else the API sends back, so the fixture only models
// what the form reads.
function makeCronjob(schedule: Schedule | null): Cronjob {
  return {
    id: "cj-1",
    name: "Nightly backup",
    connectionId: "conn-1",
    schedule,
    isActive: true,
  } as Cronjob;
}

function renderForm(props: Partial<ComponentProps<typeof CronjobForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <CronjobForm
        connections={connections}
        connectionsLoading={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        isLoading={false}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSubmit, user: userEvent.setup() };
}

type User = ReturnType<typeof userEvent.setup>;

async function fillRequiredFields(user: User) {
  await user.type(screen.getByLabelText("Name"), "Nightly backup");
  await user.selectOptions(
    screen.getByLabelText("Connection (production)"),
    "conn-1",
  );
}

async function chooseCustom(user: User) {
  await user.selectOptions(screen.getByLabelText("Frequency"), "custom");
}

async function chooseRepeat(user: User, kind: string) {
  await chooseCustom(user);
  await user.selectOptions(screen.getByLabelText("Repeat"), kind);
}

// The live region that sums the chosen schedule up in plain language.
function summary() {
  return screen.getByRole("status");
}

function submittedDto(onSubmit: ReturnType<typeof vi.fn>) {
  expect(onSubmit).toHaveBeenCalledTimes(1);
  return onSubmit.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

describe("CronjobForm: new cronjob", () => {
  it("defaults to the daily 02:00 preset and summarises it in plain language", () => {
    renderForm();

    expect(screen.getByLabelText("Frequency")).toHaveValue("daily");
    expect(summary()).toHaveTextContent("Every day at 02:00");
    expect(summary()).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
  });

  it("offers the presets and Custom, without the advanced option", () => {
    renderForm();

    const options = within(screen.getByLabelText("Frequency")).getAllByRole(
      "option",
    );
    expect(options.map((o) => o.textContent)).toEqual([
      "Every hour",
      "Every day at 02:00",
      "Every Monday at 02:00",
      "Custom",
    ]);
  });

  it("never shows a cron input, formula or frequency code", async () => {
    const { user } = renderForm();
    const container = document.body;
    const expectNoCron = () => {
      expect(container.textContent).not.toMatch(/cron(?!job)/i);
      expect(container.textContent).not.toMatch(/[*]/);
      expect(screen.queryByLabelText(/expression/i)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText(/\*/)).not.toBeInTheDocument();
      expect(container.querySelector("code, .font-mono")).toBeNull();
      expect(container.querySelector('[name="cronExpression"]')).toBeNull();
    };

    expectNoCron();
    await chooseCustom(user);
    expectNoCron();
    await user.selectOptions(screen.getByLabelText("Repeat"), "weekly");
    expectNoCron();
  });

  it("submits the default schedule with no cron fields", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);

    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    const dto = submittedDto(onSubmit);
    expect(dto).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "daily", time: "02:00" },
    });
    expect(dto).not.toHaveProperty("cronExpression");
    expect(dto).not.toHaveProperty("frequency");
  });

  it.each([
    ["Every hour", { kind: "every_hours", everyHours: 1 }],
    ["Every Monday at 02:00", { kind: "weekly", time: "02:00", daysOfWeek: [1] }],
  ] satisfies Array<[string, Schedule]>)(
    "submits the %s preset as a schedule",
    async (label, schedule) => {
      const { onSubmit, user } = renderForm();
      await fillRequiredFields(user);

      await user.selectOptions(screen.getByLabelText("Frequency"), label);
      expect(summary()).toHaveTextContent(label);
      await user.click(screen.getByRole("button", { name: "Create cronjob" }));

      expect(submittedDto(onSubmit)).toEqual({
        name: "Nightly backup",
        connectionId: "conn-1",
        schedule,
      });
    },
  );
});

describe("CronjobForm: custom schedule builder", () => {
  it("reveals the builder when Custom is chosen", async () => {
    const { user } = renderForm();

    await chooseCustom(user);

    expect(screen.getByLabelText("Frequency")).toHaveValue("custom");
    expect(screen.getByLabelText("Repeat")).toHaveValue("daily");
    expect(
      within(screen.getByLabelText("Repeat"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Every few hours", "Daily", "Weekly", "Monthly"]);
    expect(screen.getByLabelText("Time")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Time")).toHaveValue("02:00");
  });

  it("stays on Custom while the builder values match a preset", async () => {
    const { user } = renderForm();

    await chooseCustom(user);

    expect(screen.getByLabelText("Frequency")).toHaveValue("custom");
    expect(screen.getByLabelText("Repeat")).toBeInTheDocument();
  });

  it("submits an every-few-hours schedule", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "every_hours");

    expect(screen.queryByLabelText("Time")).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Interval"))
        .getAllByRole("option")
        .map((o) => o.getAttribute("value")),
    ).toEqual(["1", "2", "3", "4", "6", "8", "12"]);

    await user.selectOptions(screen.getByLabelText("Interval"), "8");
    expect(summary()).toHaveTextContent("Every 8 hours");
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "every_hours", everyHours: 8 },
    });
  });

  it("submits a daily schedule at the chosen time", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "daily");

    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "07:30" },
    });
    expect(summary()).toHaveTextContent("Every day at 07:30");
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "daily", time: "07:30" },
    });
  });

  it("lists the weekdays Monday first and submits the chosen ones", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "weekly");

    const days = within(
      screen.getByRole("group", { name: "Days of the week" }),
    ).getAllByRole("button");
    expect(days.map((d) => d.getAttribute("aria-label"))).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(days.map((d) => d.textContent)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);

    // Monday is preselected; every toggle exposes its state.
    expect(screen.getByRole("button", { name: "Monday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Friday" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Friday" }));
    await user.click(screen.getByRole("button", { name: "Sunday" }));
    expect(screen.getByRole("button", { name: "Friday" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(summary()).toHaveTextContent(
      "Every Monday, Friday and Sunday at 02:00",
    );

    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    // Values keep the API numbering: 0 is Sunday.
    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "weekly", time: "02:00", daysOfWeek: [0, 1, 5] },
    });
  });

  it("blocks a weekly schedule without days and explains why", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "weekly");

    await user.click(screen.getByRole("button", { name: "Monday" }));
    expect(summary()).toHaveTextContent(
      "Pick the days of the week to see the summary.",
    );
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select at least one day of the week",
    );

    // Picking a day clears the error and lets the form through.
    await user.click(screen.getByRole("button", { name: "Tuesday" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(submittedDto(onSubmit).schedule).toEqual({
      kind: "weekly",
      time: "02:00",
      daysOfWeek: [2],
    });
  });

  it("submits a monthly schedule limited to days 1 to 28", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "monthly");

    const options = within(screen.getByLabelText("Day of the month")).getAllByRole(
      "option",
    );
    expect(options).toHaveLength(28);
    expect(options[0]).toHaveValue("1");
    expect(options[27]).toHaveValue("28");

    await user.selectOptions(screen.getByLabelText("Day of the month"), "15");
    expect(summary()).toHaveTextContent("On day 15 of every month at 02:00");
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "monthly", time: "02:00", dayOfMonth: 15 },
    });
  });

  it("keeps the time when the repeat kind changes", async () => {
    const { onSubmit, user } = renderForm();
    await fillRequiredFields(user);
    await chooseRepeat(user, "daily");
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "21:15" },
    });

    await user.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(submittedDto(onSubmit).schedule).toEqual({
      kind: "monthly",
      time: "21:15",
      dayOfMonth: 1,
    });
  });
});

describe("CronjobForm: required fields", () => {
  it("requires a name", async () => {
    const { onSubmit, user } = renderForm();

    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeVisible();
  });

  it("requires a connection", async () => {
    const { onSubmit, user } = renderForm();
    await user.type(screen.getByLabelText("Name"), "Nightly backup");

    await user.click(screen.getByRole("button", { name: "Create cronjob" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Connection is required")).toBeVisible();
  });
});

describe("CronjobForm: editing", () => {
  it("prefills a schedule the presets do not cover as Custom", () => {
    renderForm({
      cronjob: makeCronjob({
        kind: "weekly",
        time: "09:30",
        daysOfWeek: [1, 3, 5],
      }),
    });

    expect(screen.getByLabelText("Name")).toHaveValue("Nightly backup");
    expect(screen.getByLabelText("Frequency")).toHaveValue("custom");
    expect(screen.getByLabelText("Repeat")).toHaveValue("weekly");
    expect(screen.getByLabelText("Time")).toHaveValue("09:30");
    for (const [day, pressed] of [
      ["Monday", "true"],
      ["Tuesday", "false"],
      ["Wednesday", "true"],
      ["Friday", "true"],
      ["Sunday", "false"],
    ]) {
      expect(screen.getByRole("button", { name: day })).toHaveAttribute(
        "aria-pressed",
        pressed,
      );
    }
    expect(summary()).toHaveTextContent(
      "Every Monday, Wednesday and Friday at 09:30",
    );
  });

  it("shows a schedule equal to a preset as that preset", () => {
    renderForm({
      cronjob: makeCronjob({ kind: "every_hours", everyHours: 1 }),
    });

    expect(screen.getByLabelText("Frequency")).toHaveValue("hourly");
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
  });

  it("does not send the schedule when it was left alone", async () => {
    const { onSubmit, user } = renderForm({
      cronjob: makeCronjob({ kind: "daily", time: "02:00" }),
    });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Renamed",
      connectionId: "conn-1",
    });
  });

  it("sends the schedule once it changed", async () => {
    const { onSubmit, user } = renderForm({
      cronjob: makeCronjob({ kind: "daily", time: "02:00" }),
    });

    await user.selectOptions(screen.getByLabelText("Frequency"), "hourly");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const dto = submittedDto(onSubmit);
    expect(dto).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "every_hours", everyHours: 1 },
    });
    expect(dto).not.toHaveProperty("cronExpression");
    expect(dto).not.toHaveProperty("frequency");
  });
});

describe("CronjobForm: editing a job with an advanced schedule", () => {
  it("explains that the schedule is kept and shows no formula", () => {
    renderForm({ cronjob: makeCronjob(null) });

    expect(screen.getByRole("note")).toHaveTextContent(
      "This cronjob uses an advanced schedule that keeps running unchanged unless you choose a new one.",
    );
    expect(screen.getByLabelText("Frequency")).toHaveValue("keep");
    expect(
      within(screen.getByLabelText("Frequency")).getByRole("option", {
        name: "Advanced schedule (unchanged)",
      }),
    ).toBeInTheDocument();
    expect(summary()).toHaveTextContent("Custom schedule");
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/cron(?!job)/i);
  });

  it("submits without any schedule when the schedule is left untouched", async () => {
    const { onSubmit, user } = renderForm({ cronjob: makeCronjob(null) });
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Renamed");

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const dto = submittedDto(onSubmit);
    expect(dto).toEqual({ name: "Renamed", connectionId: "conn-1" });
    expect(dto).not.toHaveProperty("schedule");
    expect(dto).not.toHaveProperty("cronExpression");
    expect(dto).not.toHaveProperty("frequency");
  });

  it("sends the schedule when a preset is picked", async () => {
    const { onSubmit, user } = renderForm({ cronjob: makeCronjob(null) });

    await user.selectOptions(screen.getByLabelText("Frequency"), "daily");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
      schedule: { kind: "daily", time: "02:00" },
    });
  });

  it("sends the schedule when a custom one is built", async () => {
    const { onSubmit, user } = renderForm({ cronjob: makeCronjob(null) });

    await user.selectOptions(screen.getByLabelText("Frequency"), "custom");
    await user.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(submittedDto(onSubmit).schedule).toEqual({
      kind: "monthly",
      time: "02:00",
      dayOfMonth: 1,
    });
  });

  it("omits the schedule again after going back to the unchanged option", async () => {
    const { onSubmit, user } = renderForm({ cronjob: makeCronjob(null) });

    await user.selectOptions(screen.getByLabelText("Frequency"), "hourly");
    await user.selectOptions(screen.getByLabelText("Frequency"), "keep");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(submittedDto(onSubmit)).toEqual({
      name: "Nightly backup",
      connectionId: "conn-1",
    });
  });

  it("does not offer the unchanged option for a new cronjob", () => {
    renderForm();

    expect(
      within(screen.getByLabelText("Frequency")).queryByRole("option", {
        name: "Advanced schedule (unchanged)",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("CronjobForm: Spanish", () => {
  it("renders the builder and the summary in Spanish", async () => {
    await i18n.changeLanguage("es");
    const { user } = renderForm();

    expect(summary()).toHaveTextContent("Todos los días a las 02:00");
    await user.selectOptions(screen.getByLabelText("Frecuencia"), "custom");
    await user.selectOptions(screen.getByLabelText("Repetir"), "weekly");

    expect(
      screen.getByRole("group", { name: "Días de la semana" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "lunes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(summary()).toHaveTextContent("Cada lunes a las 02:00");
  });
});
