import type { LevelWithSilent } from 'pino';
export type NODE_ENV = 'development' | 'testing' | 'production';
export type LogLevel = LevelWithSilent;
export type Config = {
    env: NODE_ENV;
    isDevelopment: boolean;
    isTesting: boolean;
    logLevel: LogLevel;
    database: {
        path: string;
        walMode: boolean;
        busyTimeout: number;
        journalMode: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
        synchronous: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
    };
    github: {
        baseUrl: string;
        graphqlUrl: string;
        userAgent: string;
        timeout: number;
        maxRetries: number;
        retryDelay: number;
        // Note: token is accessed dynamically in GitHubService
        rateLimit: {
            maxRequests: number;
            warningThreshold: number;
        };
    };
};
