/** Only explicitly public messages may cross the provider/config error boundary. */
export class PublicError extends Error {}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof PublicError) return error.message;
  const record = error as
    | {
        name?: string;
        code?: string;
        status?: number;
        cause?: { code?: string; name?: string };
      }
    | undefined;
  if (record?.name === "AbortError") return "The request was cancelled.";
  if (
    record?.name === "TimeoutError" ||
    record?.cause?.name === "ConnectTimeoutError" ||
    record?.code === "ETIMEDOUT"
  ) {
    return "The request timed out. Try again or increase the provider timeout.";
  }
  if (
    record?.code === "ECONNREFUSED" ||
    record?.cause?.code === "ECONNREFUSED"
  ) {
    return "Connection refused. Check that the configured model server is running.";
  }
  if (record?.status === 401 || record?.status === 403)
    return "Provider access was denied. Check the API key and permissions.";
  if (record?.status === 429)
    return "The provider rate limit was reached. Try again later.";
  return "The request failed. Check the configuration, provider access, and connection, then try again.";
}
