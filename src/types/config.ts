export type NODE_ENV = 'development' | 'testing' | 'production';
export type Config = {
    env: NODE_ENV;
    isDevelopment: boolean;
    database: {
        path: string;
        walMode: boolean;
        busyTimeout: number;
        journalMode: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
        synchronous: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
    };
};
