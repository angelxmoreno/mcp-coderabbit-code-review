import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import type { Services } from '../server';

// Simplified request validation schemas
const replyToCommentSchema = z.object({
    commentId: z.number().int().positive(),
    message: z.string().min(1),
});

const markCommentAsResolvedSchema = z.object({
    commentId: z.number().int().positive(),
});

const applyFixSchema = z.object({
    commentId: z.number().int().positive(),
    patch: z.string().min(1),
    commitMessage: z.string().optional(),
});

export function createCommentEndpoints(_services: Services) {
    const app = new Hono();

    // Simplified reply to comment
    app.post('/replyToComment', async (c) => {
        try {
            const body = await c.req.json();
            const { commentId, message } = replyToCommentSchema.parse(body);

            logger.info({ commentId, messageLength: message.length }, 'Reply to comment request received');

            const response = {
                success: true,
                data: { replyId: `reply-${commentId}-${Date.now()}` },
                metadata: { commentId, timestamp: new Date().toISOString() },
            };

            return c.json(response);
        } catch (error) {
            logger.error({ error }, 'Failed to reply to comment');
            return c.json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to reply to comment',
                },
                500
            );
        }
    });

    // Simplified mark as resolved
    app.post('/markCommentAsResolved', async (c) => {
        try {
            const body = await c.req.json();
            const { commentId } = markCommentAsResolvedSchema.parse(body);

            logger.info({ commentId }, 'Mark comment as resolved request received');

            const response = {
                success: true,
                data: {},
                metadata: { commentId, timestamp: new Date().toISOString() },
            };

            return c.json(response);
        } catch (error) {
            logger.error({ error }, 'Failed to mark comment as resolved');
            return c.json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to mark comment as resolved',
                },
                500
            );
        }
    });

    // Simplified apply fix
    app.post('/applyFix', async (c) => {
        try {
            const body = await c.req.json();
            const { commentId, patch, commitMessage } = applyFixSchema.parse(body);

            logger.info({ commentId, patchLength: patch.length }, 'Apply fix request received');

            const defaultCommitMessage = commitMessage || `Fix: Applied suggested change from comment ${commentId}`;

            const response = {
                success: true,
                data: { commitHash: `abc${commentId}def` },
                metadata: {
                    commentId,
                    commitMessage: defaultCommitMessage,
                    timestamp: new Date().toISOString(),
                },
            };

            return c.json(response);
        } catch (error) {
            logger.error({ error }, 'Failed to apply fix');
            return c.json(
                {
                    success: false,
                    error: error instanceof Error ? error.message : 'Failed to apply fix',
                },
                500
            );
        }
    });

    return app;
}
