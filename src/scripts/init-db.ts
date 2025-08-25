// Script to initialize the database with schema and initial data
// Should be runnable via: bun run src/scripts/init-db.ts

import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';

async function initializeDatabase() {
    logger.info('Initializing database...');
    const dbService = new DatabaseService();
    try {
        await dbService.connect();
        logger.info('Database initialization complete.');
        await dbService.close();
    } catch (error) {
        logger.error({ error }, 'Failed to initialize database');
        process.exit(1);
    }
}

if (import.meta.main) {
    initializeDatabase();
}
