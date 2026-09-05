/**
 * Local compatibility shim for legacy analytics call sites.
 *
 * The distribution deliberately does not initialize or bundle a remote
 * analytics client. Keeping a typed no-op object lets feature code retain its
 * instrumentation boundaries without sending data or opening a connection.
 */
export const noopPosthog = {
  capture: (_event: string, _properties?: Record<string, unknown>): void =>
    undefined,
};

export const usePostHog = () => noopPosthog;

export default noopPosthog;
