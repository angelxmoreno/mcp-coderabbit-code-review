import type { Config, LogLevel, NODE_ENV } from './types/config.ts';

const env = (Bun.env.NODE_ENV ?? 'development') as NODE_ENV;
const isDevelopment = env === 'development';
const isTesting = env === 'test';
export const config: Config = {
    env,
    isDevelopment,
    isTesting,
    logLevel: (Bun.env.LOG_LEVEL ?? (isTesting ? 'silent' : 'info')) as LogLevel,
    database: {
        path: '.coderabbit-mcp/state.db',
        walMode: true,
        busyTimeout: 5000,
        journalMode: 'WAL',
        synchronous: 'NORMAL',
    },
    github: {
        baseUrl: 'https://api.github.com',
        graphqlUrl: 'https://api.github.com/graphql',
        userAgent: 'MCP-CodeRabbit-Server/1.0.0',
        timeout: 10000,
        maxRetries: 3,
        retryDelay: 1000,
        // Note: token is accessed dynamically in GitHubService
        rateLimit: {
            maxRequests: 5000,
            warningThreshold: 100,
        },
    },
};
