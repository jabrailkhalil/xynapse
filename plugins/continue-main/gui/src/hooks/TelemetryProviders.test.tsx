import { render, screen } from "@testing-library/react";
import posthog from "posthog-js";
import { expect, test, vi } from "vitest";
import TelemetryProviders from "./TelemetryProviders";

test.each([true, false])(
  "renders children and performs no telemetry when legacy opt-in is %s",
  (legacyOptIn) => {
    const capture = vi.spyOn(posthog, "capture");
    (window as any).allowAnonymousTelemetry = legacyOptIn;
    render(
      <TelemetryProviders>
        <div data-testid="child">Private workspace</div>
      </TelemetryProviders>,
    );

    expect(screen.getByTestId("child")).toHaveTextContent("Private workspace");
    expect(capture).not.toHaveBeenCalled();
    capture.mockRestore();
  },
);
