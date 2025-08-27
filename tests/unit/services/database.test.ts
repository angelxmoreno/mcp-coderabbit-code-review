import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DatabaseError } from '../../../src/errors/database/DatabaseError';
import { DatabaseService } from '../../../src/services/database';

import type { CommentFilters, CommentInsert } from '../../../src/types/database';

describe('DatabaseService', () => {
    let dbService: DatabaseService;

    beforeEach(async () => {
        dbService = new DatabaseService(':memory:');
        await dbService.connect();
    });

    afterEach(async () => {
        await dbService.close();
    });

    describe('Connection Management', () => {
        it('should connect to database successfully', async () => {
            const newService = new DatabaseService(':memory:');
            await newService.connect();

            const pr = newService.createPr('test/repo', 123);
            expect(pr.repo).toBe('test/repo');
            expect(pr.number).toBe(123);

            await newService.close();
        });

        it('should throw error when operating on closed database', async () => {
            await dbService.close();

            expect(() => {
                dbService.createPr('test/repo', 123);
            }).toThrow(DatabaseError);
        });

        it('should handle double close gracefully', async () => {
            await dbService.close();
            await expect(dbService.close()).resolves.toBeUndefined();
        });
    });

    describe('PR Operations', () => {
        it('should create PR successfully', () => {
            const pr = dbService.createPr('test/repo', 123);

            expect(pr.id).toBeGreaterThan(0);
            expect(pr.repo).toBe('test/repo');
            expect(pr.number).toBe(123);
            expect(pr.last_synced).toBeTruthy();
        });

        it('should enforce unique constraint on repo+number', () => {
            dbService.createPr('test/repo', 123);

            expect(() => {
                dbService.createPr('test/repo', 123);
            }).toThrow(DatabaseError);
        });

        it('should get existing PR', () => {
            const created = dbService.createPr('test/repo', 123);
            const retrieved = dbService.getPr('test/repo', 123);

            expect(retrieved).toEqual(created);
        });

        it('should return null for non-existent PR', () => {
            const result = dbService.getPr('nonexistent/repo', 999);
            expect(result).toBeNull();
        });

        it('should list PRs with optional repo filter', () => {
            dbService.createPr('repo1', 1);
            dbService.createPr('repo1', 2);
            dbService.createPr('repo2', 1);

            const allPrs = dbService.listPrs();
            expect(allPrs).toHaveLength(3);

            const repo1Prs = dbService.listPrs('repo1');
            expect(repo1Prs).toHaveLength(2);
            expect(repo1Prs.every((pr) => pr.repo === 'repo1')).toBe(true);
        });
    });

    describe('Comment Operations', () => {
        let prId: number;

        beforeEach(() => {
            const pr = dbService.createPr('test/repo', 123);
            prId = pr.id;
        });

        it('should create comment successfully', () => {
            const commentData: CommentInsert = {
                pr_id: prId,
                file: 'src/test.ts',
                line: 10,
                author: 'coderabbit',
                original_comment: 'Consider using const instead of let',
                prompt_for_ai_agents: 'Should we use const instead of let here?',
            };

            const comment = dbService.createComment(commentData);

            expect(comment.id).toBeGreaterThan(0);
            expect(comment.pr_id).toBe(prId);
            expect(comment.file).toBe('src/test.ts');
            expect(comment.line).toBe(10);
            expect(comment.replied).toBe(false);
            expect(comment.fix_applied).toBe(false);
            expect(comment.created_at).toBeTruthy();
        });

        it('should get comment by id', () => {
            const commentData: CommentInsert = {
                pr_id: prId,
                original_comment: 'Test comment',
            };

            const created = dbService.createComment(commentData);
            const retrieved = dbService.getComment(created.id);

            expect(retrieved).toEqual(created);
        });

        it('should return null for non-existent comment', () => {
            const result = dbService.getComment(99999);
            expect(result).toBeNull();
        });

        it('should filter comments by pr_id', () => {
            const pr2 = dbService.createPr('test/repo2', 456);

            dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });
            dbService.createComment({ pr_id: pr2.id, original_comment: 'Comment 3' });

            const pr1Comments = dbService.getCommentsByPr(prId);
            expect(pr1Comments).toHaveLength(2);
            expect(pr1Comments.every((c) => c.pr_id === prId)).toBe(true);

            const pr2Comments = dbService.getCommentsByPr(pr2.id);
            expect(pr2Comments).toHaveLength(1);
        });

        it('should filter comments by replied status', () => {
            const comment1 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            const comment2 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });

            dbService.markCommentReplied(comment1.id, 'This is a reply');

            const filters: CommentFilters = { replied: false };
            const unreplied = dbService.getCommentsByPr(prId, filters);
            expect(unreplied).toHaveLength(1);
            expect(unreplied[0]?.id).toBe(comment2.id);

            const repliedFilters: CommentFilters = { replied: true };
            const replied = dbService.getCommentsByPr(prId, repliedFilters);
            expect(replied).toHaveLength(1);
            expect(replied[0]?.id).toBe(comment1.id);
        });

        it('should mark comment as replied', () => {
            const comment = dbService.createComment({
                pr_id: prId,
                original_comment: 'Test comment',
            });

            dbService.markCommentReplied(comment.id, 'Test reply');

            const updated = dbService.getComment(comment.id);
            expect(updated?.replied).toBe(true);
            expect(updated?.reply).toBe('Test reply');
            expect(updated?.reviewed_at).toBeTruthy();
        });

        it('should mark comment as fixed', () => {
            const comment = dbService.createComment({
                pr_id: prId,
                original_comment: 'Test comment',
            });

            dbService.markCommentFixed(comment.id);

            const updated = dbService.getComment(comment.id);
            expect(updated?.fix_applied).toBe(true);
            expect(updated?.fixed_at).toBeTruthy();
        });
    });

    describe('Analytics and Reporting', () => {
        let prId: number;

        beforeEach(() => {
            const pr = dbService.createPr('test/repo', 123);
            prId = pr.id;
        });

        it('should generate PR statistics', () => {
            const comment1 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            const comment2 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });
            const comment3 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 3' });

            dbService.markCommentReplied(comment1.id, 'Reply 1');
            dbService.markCommentReplied(comment2.id, 'Reply 2');
            dbService.markCommentFixed(comment1.id);

            const stats = dbService.getPrStats(prId);
            expect(stats.total).toBe(3);
            expect(stats.replied).toBe(2);
            expect(stats.fixed).toBe(1);
            expect(stats.pending_ids).toContain(comment3.id.toString());
        });

        it('should handle PR with no comments', () => {
            const stats = dbService.getPrStats(prId);
            expect(stats.total).toBe(0);
            expect(stats.replied).toBe(0);
            expect(stats.fixed).toBe(0);
            expect(stats.pending_ids).toBeNull();
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid comment data', () => {
            expect(() => {
                dbService.createComment({ pr_id: 99999, original_comment: 'Test' });
            }).toThrow();
        });

        it('should validate agreement values', () => {
            const pr = dbService.createPr('test/repo', 123);
            const comment = dbService.createComment({
                pr_id: pr.id,
                original_comment: 'Test',
            });

            expect(() => {
                dbService.updateComment(comment.id, { agreement: 'yes' });
            }).not.toThrow();

            expect(() => {
                dbService.updateComment(comment.id, { agreement: 'no' });
            }).not.toThrow();

            expect(() => {
                dbService.updateComment(comment.id, { agreement: 'partially' });
            }).not.toThrow();
        });
    });
});
