import type { Config, NODE_ENV } from './types/config.ts';

const env = (Bun.env.NODE_ENV ?? 'development') as NODE_ENV;
const isDevelopment = env !== 'production';

export const config: Config = {
    env,
    isDevelopment,
    database: {
        path: '.coderabbit-mcp/state.db',
        walMode: true,
        busyTimeout: 5000,
        journalMode: 'WAL',
        synchronous: 'NORMAL',
    },
};
