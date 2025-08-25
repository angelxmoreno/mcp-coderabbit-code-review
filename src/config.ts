import type { Config, NODE_ENV } from './types/config.ts';

export const config: Config = {
    env: (Bun.env.NODE_ENV ?? 'development') as NODE_ENV,
};
