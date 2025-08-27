import { config } from './config';
import { createMcpServer } from './mcp/server';
import { CodeRabbitService } from './services/coderabbit';
import { DatabaseService } from './services/database';
import { GitHubService } from './services/github';
import { WorkflowEngine } from './services/workflow';
import { logger } from './utils/logger';

async function main() {
    try {
        logger.info('Starting MCP CodeRabbit server...');

        // Load configuration
        logger.info('Loading configuration...');
        logger.info({ dbPath: config.database.path }, 'Configuration loaded');

        // Initialize database service
        logger.info('Initializing database service...');
        const databaseService = new DatabaseService(config.database.path);
        await databaseService.connect();
        logger.info('Database connected successfully');

        // Initialize GitHub service
        logger.info('Initializing GitHub service...');
        const githubToken = Bun.env.GITHUB_TOKEN || 'dummy-token-for-testing';
        const githubService = new GitHubService(githubToken);
        logger.info('GitHub service initialized');

        // Initialize CodeRabbit service
        logger.info('Initializing CodeRabbit service...');
        const coderabbitService = new CodeRabbitService(databaseService);
        logger.info('CodeRabbit service initialized');

        // Initialize Workflow engine
        logger.info('Initializing Workflow engine...');
        const workflowEngine = new WorkflowEngine(githubToken);
        logger.info('Workflow engine initialized');

        // Create MCP server with all services
        const server = createMcpServer({
            database: databaseService,
            github: githubService,
            coderabbit: coderabbitService,
            workflow: workflowEngine,
        });

        // Setup graceful shutdown
        const cleanup = async () => {
            logger.info('Shutting down MCP server...');
            try {
                await databaseService.close();
                logger.info('Database connection closed');
            } catch (error) {
                logger.error({ error }, 'Error during shutdown');
            }
            process.exit(0);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

        // Start server
        const port = config.server.port;
        logger.info({ port }, 'MCP server starting...');

        // Export Bun server
        return {
            port,
            fetch: server.fetch,
        };
    } catch (error) {
        logger.error({ error }, 'Failed to start MCP server');
        process.exit(1);
    }
}

// Export default for Bun server
export default main();
