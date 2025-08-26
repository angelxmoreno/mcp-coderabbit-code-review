import { CodeRabbitError } from '../errors/coderabbit/CodeRabbitError';
import { CommentParsingError } from '../errors/coderabbit/CommentParsingError';
import type { CodeRabbitAnalysis, PromptExtractionResult } from '../types/coderabbit';
import type { GitHubReviewComment } from '../types/github';
import { logger } from '../utils/logger';
import type { DatabaseService } from './database';

export class CodeRabbitService {
    constructor(private databaseService: DatabaseService) {
        logger.info('CodeRabbit service initialized');
    }

    // Check if comment is from CodeRabbit
    isCodeRabbitComment(comment: GitHubReviewComment): boolean {
        try {
            if (!comment || !comment.user || !comment.body) {
                return false;
            }

            return (
                comment.user.login === 'coderabbitai' &&
                comment.user.type === 'Bot' &&
                comment.body.includes('**Prompt for AI Agents:**')
            );
        } catch (error) {
            logger.error({ error, commentId: comment?.id }, 'Error checking CodeRabbit comment');
            return false;
        }
    }

    // Extract AI prompt from comment body
    extractAIPrompt(commentBody: string): PromptExtractionResult {
        try {
            if (!commentBody || typeof commentBody !== 'string') {
                throw new CommentParsingError('Comment body is required and must be a string');
            }

            const match = commentBody.match(/\*\*Prompt for AI Agents:\*\*\s*(.+?)(?:\n|$)/);

            if (match?.[1]) {
                return {
                    found: true,
                    prompt: match[1].trim(),
                };
            }

            return {
                found: false,
                prompt: null,
            };
        } catch (error) {
            if (error instanceof CommentParsingError) {
                throw error;
            }
            throw new CommentParsingError('Failed to extract AI prompt', { cause: error });
        }
    }

    // Analyze a single comment
    analyzeComment(comment: GitHubReviewComment): CodeRabbitAnalysis | null {
        try {
            if (!comment || !comment.id || !comment.body) {
                throw new CommentParsingError('Invalid comment structure');
            }

            if (!this.isCodeRabbitComment(comment)) {
                return null;
            }

            const extraction = this.extractAIPrompt(comment.body);

            const analysis: CodeRabbitAnalysis = {
                commentId: comment.id,
                aiPrompt: extraction.prompt,
                extractedAt: new Date().toISOString(),
            };

            // Store in database
            this.databaseService.storeCodeRabbitAnalysis(analysis);

            logger.debug({ commentId: comment.id, hasPrompt: !!extraction.prompt }, 'Analyzed CodeRabbit comment');

            return analysis;
        } catch (error) {
            if (error instanceof CommentParsingError) {
                throw error;
            }
            throw new CodeRabbitError('Failed to analyze comment', { cause: error });
        }
    }

    // Process multiple comments
    processComments(comments: GitHubReviewComment[]): CodeRabbitAnalysis[] {
        const results: CodeRabbitAnalysis[] = [];
        const errors: string[] = [];

        for (const comment of comments) {
            try {
                const analysis = this.analyzeComment(comment);
                if (analysis) {
                    results.push(analysis);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                const commentId = comment?.id ?? 'unknown';
                errors.push(`Comment ${commentId}: ${errorMsg}`);
                logger.error({ error, commentId }, 'Failed to process comment');
            }
        }

        if (errors.length > 0) {
            logger.warn(
                {
                    errorCount: errors.length,
                    totalComments: comments.length,
                    successCount: results.length,
                },
                'Some comments failed to process'
            );
        }

        logger.info(
            {
                processed: results.length,
                total: comments.length,
            },
            'Completed comment processing'
        );

        return results;
    }
}
