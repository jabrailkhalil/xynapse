import { PropsWithChildren } from "react";

/**
 * Xynapse ships with product telemetry disabled.
 *
 * Keeping this boundary as a component preserves the application structure
 * without initializing PostHog or Sentry, identifying the device, or opening
 * any telemetry network connection—even if an imported profile contains the
 * legacy allowAnonymousTelemetry flag.
 */
const TelemetryProviders = ({ children }: PropsWithChildren) => <>{children}</>;

export default TelemetryProviders;
