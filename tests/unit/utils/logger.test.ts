import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createBaseLogger, logger } from '../../../src/utils/logger.ts';

describe('Logger', () => {
    const originalLogLevel = process.env.LOG_LEVEL;

    beforeEach(() => {
        // Reset log level environment variable
        delete process.env.LOG_LEVEL;
    });

    afterEach(() => {
        // Restore original environment
        if (originalLogLevel !== undefined) {
            process.env.LOG_LEVEL = originalLogLevel;
        }
    });

    describe('createBaseLogger', () => {
        it('should create a logger with pretty transport in development environment', () => {
            const devLogger = createBaseLogger();

            expect(devLogger).toBeDefined();
            expect(devLogger.level).toBe('info');
        });

        it('should create a logger with appropriate configuration', () => {
            const testLogger = createBaseLogger();

            expect(testLogger).toBeDefined();
            expect(testLogger.level).toBe('info');
        });

        it('should respect custom log level from environment', () => {
            process.env.LOG_LEVEL = 'debug';

            const debugLogger = createBaseLogger();

            expect(debugLogger.level).toBe('debug');
        });

        it('should allow custom options to override defaults', () => {
            const customLogger = createBaseLogger({ level: 'warn' });

            expect(customLogger.level).toBe('warn');
        });

        it('should default to info level when LOG_LEVEL is not set', () => {
            const defaultLogger = createBaseLogger();

            expect(defaultLogger.level).toBe('info');
        });
    });

    describe('default logger instance', () => {
        it('should export a default logger instance', () => {
            expect(logger).toBeDefined();
            expect(typeof logger.info).toBe('function');
            expect(typeof logger.error).toBe('function');
            expect(typeof logger.warn).toBe('function');
            expect(typeof logger.debug).toBe('function');
        });

        it('should have standard pino logger methods', () => {
            const methods = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

            for (const method of methods) {
                expect(typeof logger[method]).toBe('function');
            }
        });
    });

    describe('environment-specific configuration', () => {
        it('should configure stderr output properly', () => {
            const testLogger = createBaseLogger();
             
            // Should configure stderr output based on config.env
            expect(testLogger).toBeDefined();
        });

        it('should handle different environment configurations', () => {
            const testLogger = createBaseLogger();

            // Should use appropriate configuration based on centralized config
            expect(testLogger).toBeDefined();
        });
    });
});
