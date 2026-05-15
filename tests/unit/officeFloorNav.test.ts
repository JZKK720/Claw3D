import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OfficeFloorNav } from "@/features/office/components/OfficeFloorNav";
import { createFloorRosterCache } from "@/lib/office/floorRoster";

describe("OfficeFloorNav", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows all enabled runtime floors while the lobby is active", () => {
    render(
      createElement(OfficeFloorNav, {
        activeFloorId: "lobby",
        floorRosterCache: createFloorRosterCache(),
        onSelectFloor: vi.fn(),
        activeAdapterType: "openclaw",
        showAllEnabledFloors: true,
      }),
    );

    expect(screen.getByRole("button", { name: "Select OpenClaw Floor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select IronClaw Floor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Hermes Floor" })).toBeInTheDocument();
  });

  it("keeps adapter-scoped runtime floors outside the lobby", () => {
    render(
      createElement(OfficeFloorNav, {
        activeFloorId: "openclaw-ground",
        floorRosterCache: createFloorRosterCache(),
        onSelectFloor: vi.fn(),
        activeAdapterType: "openclaw",
      }),
    );

    expect(
      screen.getAllByRole("button", { name: "Select OpenClaw Floor" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Select IronClaw Floor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select Hermes Floor" }),
    ).not.toBeInTheDocument();
  });
});