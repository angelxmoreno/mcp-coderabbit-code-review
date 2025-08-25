import type {Config, NODE_ENV} from './types/config.ts';

const env = (Bun.env.NODE_ENV ?? 'development') as NODE_ENV;
const isDevelopment = env !== 'production';

export const config: Config = {
    env,
    isDevelopment,
};
