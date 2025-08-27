import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CodeRabbitService } from '../../src/services/coderabbit';
import { DatabaseService } from '../../src/services/database';
import type { BaseComment } from '../../src/types/bots';
import { parseCodeRabbitComment } from '../../src/utils/bot-parser';

describe('End-to-End Workflow Integration', () => {
    let databaseService: DatabaseService;
    let coderabbitService: CodeRabbitService;

    beforeEach(async () => {
        // Use in-memory database for testing
        databaseService = new DatabaseService(':memory:');
        await databaseService.connect();

        coderabbitService = new CodeRabbitService(databaseService);
    });

    afterEach(async () => {
        await databaseService.close();
    });

    describe('Complete Workflow Pipeline', () => {
        it('should process CodeRabbit comments from raw data to database storage', async () => {
            // Simulate fetched GitHub comments with CodeRabbit data
            const mockComments: BaseComment[] = [
                {
                    commentId: 12345,
                    body: `_⚠️ Potential issue_

**Memory leak detected in event listeners**

This component doesn't clean up event listeners, which can cause memory leaks.

\`\`\`diff
- useEffect(() => {
-   window.addEventListener('resize', handleResize);
- }, []);
+ useEffect(() => {
+   window.addEventListener('resize', handleResize);
+   return () => window.removeEventListener('resize', handleResize);
+ }, []);
\`\`\`

<summary>🤖 Prompt for AI Agents</summary>

\`\`\`
Review this React component and suggest proper cleanup patterns for event listeners to prevent memory leaks.
\`\`\`

<summary>🪛 ESLint Plugin React Hooks</summary>

Effect cleanup function should remove event listeners.

\`\`\`suggestion
useEffect(() => {
  const handleResize = () => setWindowWidth(window.innerWidth);
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
\`\`\`

<!-- fingerprinting:memory:react:cleanup -->`,
                    author: { login: 'coderabbitai[bot]' },
                    createdAt: '2025-08-27T12:00:00Z',
                    url: 'https://github.com/owner/repo/pull/123#issuecomment-12345',
                    path: 'src/components/WindowSize.tsx',
                    position: 15,
                    isResolved: false,
                    isOutdated: false,
                    isMinimized: false,
                },
                {
                    commentId: 67890,
                    body: 'This looks good to me! 👍',
                    author: { login: 'developer123' },
                    createdAt: '2025-08-27T12:05:00Z',
                    url: 'https://github.com/owner/repo/pull/123#issuecomment-67890',
                    path: 'src/components/WindowSize.tsx',
                    position: 20,
                    isResolved: false,
                    isOutdated: false,
                    isMinimized: false,
                },
            ];

            // Step 1: Create PR in database
            const pr = databaseService.createPr('owner/repo', 123);
            expect(pr.id).toBeGreaterThan(0);

            // Step 2: Parse comments using new type system
            const coderabbitComments = coderabbitService.parseCodeRabbitComments(mockComments);
            expect(coderabbitComments).toHaveLength(1);

            const [coderabbitComment] = coderabbitComments;
            expect(coderabbitComment?.bot).toBe('coderabbitai[bot]');
            expect(coderabbitComment?.type).toBe('Potential issue');
            expect(coderabbitComment?.summary).toBe('Memory leak detected in event listeners');
            expect(coderabbitComment?.aiPrompt).toContain('Review this React component');
            expect(coderabbitComment?.tools).toContain('ESLint Plugin React Hooks');
            expect(coderabbitComment?.internalId).toBe('memory:react:cleanup');

            // Step 3: Store parsed comment in enhanced database schema
            if (coderabbitComment) {
                const storedComment = databaseService.createComment({
                    pr_id: pr.id,
                    file: coderabbitComment.path,
                    line: coderabbitComment.position,
                    author: coderabbitComment.author.login,
                    bot_type: coderabbitComment.bot,
                    original_comment: coderabbitComment.body,
                    comment_type: coderabbitComment.type,
                    summary: coderabbitComment.summary,
                    diff: coderabbitComment.diff,
                    suggested_code: coderabbitComment.suggestedCode,
                    ai_prompt: coderabbitComment.aiPrompt,
                    tools: coderabbitComment.tools.join(', '),
                    internal_id: coderabbitComment.internalId,
                    is_resolved: coderabbitComment.isResolved ?? false,
                    is_outdated: coderabbitComment.isOutdated ?? false,
                    is_minimized: coderabbitComment.isMinimized ?? false,
                });

                expect(storedComment.id).toBeGreaterThan(0);
                expect(storedComment.bot_type).toBe('coderabbitai[bot]');
                expect(storedComment.comment_type).toBe('Potential issue');
                expect(storedComment.summary).toBe('Memory leak detected in event listeners');
                expect(storedComment.ai_prompt).toContain('Review this React component');
                expect(storedComment.tools).toBe('ESLint Plugin React Hooks');
            }

            // Step 4: Verify enhanced analysis (direct parsing - storage tested separately)
            if (coderabbitComment) {
                const directParsed = parseCodeRabbitComment(coderabbitComment);
                expect(directParsed.commentId).toBe(12345);
                expect(directParsed.bot).toBe('coderabbitai[bot]');
                expect(directParsed.aiPrompt).toContain('Review this React component');
            }

            // Step 5: Validate PR statistics
            const stats = databaseService.getPrStats(pr.id);
            expect(stats.total).toBe(1);
            expect(stats.replied).toBe(0);
            expect(stats.fixed).toBe(0);
        });

        it('should handle mixed comment types correctly', async () => {
            const mixedComments: BaseComment[] = [
                // Regular comment
                {
                    commentId: 1,
                    body: 'Regular comment from developer',
                    author: { login: 'developer1' },
                    createdAt: '2025-08-27T10:00:00Z',
                    url: 'https://github.com/owner/repo/pull/1#comment-1',
                },
                // CodeRabbit comment with AI prompt
                {
                    commentId: 2,
                    body: `_💡 Suggestion_

**Consider using const instead of let**

<summary>🤖 Prompt for AI Agents</summary>

\`\`\`
Should this variable be declared as const instead of let?
\`\`\``,
                    author: { login: 'coderabbitai[bot]' },
                    createdAt: '2025-08-27T10:01:00Z',
                    url: 'https://github.com/owner/repo/pull/1#comment-2',
                },
                // CodeRabbit comment without AI prompt (not actionable)
                {
                    commentId: 3,
                    body: 'This code looks fine.',
                    author: { login: 'coderabbitai[bot]' },
                    createdAt: '2025-08-27T10:02:00Z',
                    url: 'https://github.com/owner/repo/pull/1#comment-3',
                },
            ];

            const _pr = databaseService.createPr('test/repo', 1);

            // Parse all comments
            const allParsed = coderabbitService.parseCodeRabbitComments(mixedComments);
            expect(allParsed).toHaveLength(2); // Only CodeRabbit comments

            // Filter actionable comments
            const actionableComments = allParsed.filter((comment) =>
                Boolean(comment.aiPrompt || comment.suggestedCode || comment.committableSuggestion)
            );
            expect(actionableComments).toHaveLength(1); // Only the one with AI prompt

            // Verify the actionable comment has correct data
            const [actionableComment] = actionableComments;
            expect(actionableComment?.type).toBe('Suggestion');
            expect(actionableComment?.summary).toBe('Consider using const instead of let');
            expect(actionableComment?.aiPrompt).toContain('Should this variable be declared as const');
        });
    });

    describe('Backward Compatibility', () => {
        it('should maintain compatibility with legacy CodeRabbitService methods', () => {
            // Legacy GitHub comment format (from existing tests)
            const legacyComment = {
                id: 123,
                body: 'Test comment with **Prompt for AI Agents:** Fix this issue',
                user: { login: 'coderabbitai', type: 'Bot' },
                path: 'test.js',
                line: 10,
            };

            // Legacy methods should still work
            const isCodeRabbitComment = coderabbitService.isCodeRabbitComment(
                legacyComment as unknown as import('../../src/types/github').GitHubReviewComment
            );
            expect(isCodeRabbitComment).toBe(true);

            const promptResult = coderabbitService.extractAIPrompt(legacyComment.body);
            expect(promptResult.found).toBe(true);
            expect(promptResult.prompt).toBe('Fix this issue');
        });

        it('should handle database schema evolution gracefully', async () => {
            // Create comment with minimal data (legacy style)
            const pr = databaseService.createPr('legacy/repo', 1);
            const minimalComment = databaseService.createComment({
                pr_id: pr.id,
                original_comment: 'Legacy comment',
                author: 'coderabbitai',
            });

            expect(minimalComment.id).toBeGreaterThan(0);
            expect(minimalComment.bot_type).toBe('coderabbitai[bot]'); // Default value
            expect(minimalComment.is_resolved).toBe(false); // Default value

            // Enhanced comment creation should also work
            const enhancedComment = databaseService.createComment({
                pr_id: pr.id,
                original_comment: 'Enhanced comment',
                author: 'coderabbitai[bot]',
                bot_type: 'coderabbitai[bot]',
                comment_type: 'Suggestion',
                summary: 'Test summary',
                ai_prompt: 'Test prompt',
                tools: 'ESLint',
                is_resolved: true,
            });

            expect(enhancedComment.comment_type).toBe('Suggestion');
            expect(enhancedComment.is_resolved).toBe(true);
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should handle malformed CodeRabbit comments gracefully', () => {
            const malformedComments: BaseComment[] = [
                {
                    commentId: 999,
                    body: 'Incomplete CodeRabbit comment with missing closing tags <summary>🤖 Prompt for AI Agents</summary> ```\nIncomplete prompt',
                    author: { login: 'coderabbitai[bot]' },
                    createdAt: '2025-08-27T10:00:00Z',
                    url: 'https://github.com/owner/repo/pull/1#comment-999',
                },
            ];

            // Should not throw error, should parse what it can
            const parsed = coderabbitService.parseCodeRabbitComments(malformedComments);
            expect(parsed).toHaveLength(1);

            const [comment] = parsed;
            expect(comment?.bot).toBe('coderabbitai[bot]');
            expect(comment?.aiPrompt).toBeUndefined(); // Malformed, so not extracted
        });

        it('should handle database constraints and validation', () => {
            const pr = databaseService.createPr('constraint/test', 1);

            // Should handle valid agreement values
            const comment = databaseService.createComment({
                pr_id: pr.id,
                original_comment: 'Test comment',
            });

            expect(() => {
                databaseService.updateComment(comment.id, { agreement: 'yes' });
            }).not.toThrow();

            expect(() => {
                databaseService.updateComment(comment.id, { agreement: 'no' });
            }).not.toThrow();

            expect(() => {
                databaseService.updateComment(comment.id, { agreement: 'partially' });
            }).not.toThrow();
        });
    });

    describe('Performance and Data Integrity', () => {
        it('should handle large comment datasets efficiently', async () => {
            const _pr = databaseService.createPr('performance/test', 1);

            // Create 100 mock comments
            const largeCommentSet: BaseComment[] = Array.from({ length: 100 }, (_, i) => ({
                commentId: i + 1,
                body:
                    i % 10 === 0
                        ? `_⚠️ Issue ${i}_\n\n<summary>🤖 Prompt for AI Agents</summary>\n\n\`\`\`\nFix issue ${i}\n\`\`\`\n\n<!-- fingerprinting:perf:test:${i} -->`
                        : `Regular comment ${i}`,
                author: { login: i % 10 === 0 ? 'coderabbitai[bot]' : 'developer' },
                createdAt: '2025-08-27T10:00:00Z',
                url: `https://github.com/owner/repo/pull/1#comment-${i + 1}`,
            }));

            const startTime = Date.now();

            // Parse comments
            const parsed = coderabbitService.parseCodeRabbitComments(largeCommentSet);

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            // Should process 100 comments quickly (under 100ms)
            expect(processingTime).toBeLessThan(100);

            // Should correctly identify CodeRabbit comments (every 10th comment)
            expect(parsed).toHaveLength(10);

            // All parsed comments should be actionable
            const actionable = parsed.filter((c) => Boolean(c.aiPrompt));
            expect(actionable).toHaveLength(10);
        });

        it('should maintain data consistency across operations', async () => {
            const pr = databaseService.createPr('consistency/test', 1);

            const baseComment: BaseComment = {
                commentId: 12345,
                body: `_⚠️ Critical Issue_

**Security vulnerability detected**

<summary>🤖 Prompt for AI Agents</summary>

\`\`\`
How should we fix this security issue?
\`\`\`

<!-- fingerprinting:security:critical -->`,
                author: { login: 'coderabbitai[bot]' },
                createdAt: '2025-08-27T12:00:00Z',
                url: 'https://github.com/owner/repo/pull/1#comment-12345',
            };

            // Parse with new system
            const parsedComment = parseCodeRabbitComment(baseComment);

            // Store in database
            const storedComment = databaseService.createComment({
                pr_id: pr.id,
                original_comment: parsedComment.body,
                author: parsedComment.author.login,
                bot_type: parsedComment.bot,
                comment_type: parsedComment.type,
                summary: parsedComment.summary,
                ai_prompt: parsedComment.aiPrompt ?? null,
                internal_id: parsedComment.internalId ?? null,
            });

            // Retrieve and verify data consistency
            const retrievedComment = databaseService.getComment(storedComment.id);
            expect(retrievedComment).not.toBeNull();
            expect(retrievedComment?.comment_type).toBe(parsedComment.type ?? null);
            expect(retrievedComment?.ai_prompt).toBe(parsedComment.aiPrompt ?? null);
            expect(retrievedComment?.internal_id).toBe(parsedComment.internalId ?? null);

            // Store analysis using new method
            coderabbitService.analyzeEnhancedComment(baseComment);

            // Verify PR stats are accurate
            const stats = databaseService.getPrStats(pr.id);
            expect(stats.total).toBe(1);
            expect(stats.replied).toBe(0);
            expect(stats.fixed).toBe(0);
        });
    });
});
