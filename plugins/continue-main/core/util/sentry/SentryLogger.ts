import os from "node:os";
import { IdeInfo } from "../../index.js";

/**
 * Xynapse does not initialize a remote error-reporting client. The small API is
 * kept so existing call sites can execute without conditional imports.
 */
export class SentryLogger {
  static client: undefined = undefined;
  static scope: undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static ideInfo: IdeInfo | undefined = undefined;
  static allowTelemetry = false;

  static async setup(
    _allowAnonymousTelemetry: boolean,
    uniqueId: string,
    ideInfo: IdeInfo,
    _userEmail?: string,
  ): Promise<void> {
    SentryLogger.allowTelemetry = false;
    SentryLogger.uniqueId = uniqueId;
    SentryLogger.ideInfo = ideInfo;
    SentryLogger.os = os.platform();
    SentryLogger.client = undefined;
    SentryLogger.scope = undefined;
  }

  static get lazyClient(): undefined {
    return undefined;
  }

  static get lazyScope(): undefined {
    return undefined;
  }

  static shutdownSentryClient(): void {
    SentryLogger.client = undefined;
    SentryLogger.scope = undefined;
  }
}

export function initializeSentry(): { client: undefined; scope: undefined } {
  return { client: undefined, scope: undefined };
}

export function createSpan<T>(
  _operation: string,
  _name: string,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return callback();
}

export function captureException(
  _error: Error,
  _context?: Record<string, unknown>,
): void {
  // Remote error reporting is disabled in the Xynapse distribution.
}

export function captureLog(
  _message: string,
  _level = "info",
  _context?: Record<string, unknown>,
): void {
  // Remote structured logging is disabled in the Xynapse distribution.
}
