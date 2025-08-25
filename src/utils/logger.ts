import pino, { type LoggerOptions } from 'pino';
import { config } from '../config.ts';

export const createBaseLogger = (options: LoggerOptions = {}) => {
    const baseOptions: LoggerOptions = {
        level: process.env.LOG_LEVEL || 'info',
        ...options,
    };

    if (config.isDevelopment) {
        // Development: Pretty-printed logs to stderr
        return pino({
            ...baseOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    destination: 2, // stderr
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    ...options.transport?.options,
                },
                ...options.transport,
            },
        });
    } else {
        // Production: Structured JSON logs to stderr
        return pino({
            ...baseOptions,
            formatters: {
                level: (label) => ({ level: label }),
            },
        }, pino.destination({ dest: 2, sync: false })); // stderr, async for performance
    }
}

// Default logger instance for application use
 export const logger = createBaseLogger();
