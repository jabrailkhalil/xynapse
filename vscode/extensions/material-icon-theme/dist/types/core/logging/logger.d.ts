import { EventEmitter } from 'node:events';
export type LogLevel = 'info' | 'error' | 'debug';
export type LogEvent = {
    level: LogLevel;
    message: string;
};
/**
 * Create a logging observer that listens to log events and calls a callback function when a log event is emitted.
 *
 * @param minLogLevel Minimum log level to observe
 * @param callback Callback function to be called when a log event is emitted
 */
export declare const createLoggingObserver: (minLogLevel: LogLevel, callback: (event: LogEvent) => void) => EventEmitter;
export declare const logger: {
    info: (message: unknown) => void;
    error: (message: unknown) => void;
    debug: (message: unknown) => void;
};
//# sourceMappingURL=logger.d.ts.map