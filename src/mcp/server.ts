import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import type { CodeRabbitService } from '../services/coderabbit';
import type { DatabaseService } from '../services/database';
import type { GitHubService } from '../services/github';
import type { WorkflowEngine } from '../services/workflow';
import { logger } from '../utils/logger';
import { createAnalysisEndpoints } from './endpoints/analysis-simple';
import { createCommentEndpoints } from './endpoints/comments-simple';
import { createWorkflowEndpoints } from './endpoints/workflow-simple';

export interface Services {
    database: DatabaseService;
    github: GitHubService;
    coderabbit: CodeRabbitService;
    workflow: WorkflowEngine;
}

export function createMcpServer(services: Services) {
    const app = new Hono();

    // Middleware
    app.use('*', cors());
    app.use('*', honoLogger());

    // Health check endpoint
    app.get('/health', (c) => {
        return c.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // MCP API routes
    app.route('/api', createWorkflowEndpoints(services));
    app.route('/api', createCommentEndpoints(services));
    app.route('/api', createAnalysisEndpoints(services));

    // Global error handler
    app.onError((err, c) => {
        logger.error({ error: err }, 'MCP server error');
        return c.json(
            {
                success: false,
                error: err.message || 'Internal server error',
                metadata: { timestamp: new Date().toISOString() },
            },
            500
        );
    });

    // 404 handler
    app.notFound((c) => {
        return c.json(
            {
                success: false,
                error: 'Endpoint not found',
                metadata: { path: c.req.path, method: c.req.method },
            },
            404
        );
    });

    logger.info('MCP server created with all endpoints registered');
    return app;
}
