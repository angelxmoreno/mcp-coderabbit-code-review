import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { CodeRabbitError } from '../../../src/errors/coderabbit/CodeRabbitError';
import { CommentParsingError } from '../../../src/errors/coderabbit/CommentParsingError';
import { CodeRabbitService } from '../../../src/services/coderabbit.ts';
import type { DatabaseService } from '../../../src/services/database.ts';
import type { GitHubReviewComment } from '../../../src/types/github.ts';

describe('CodeRabbitService', () => {
    let service: CodeRabbitService;
    let mockDb: DatabaseService;

    const mockCodeRabbitComment: GitHubReviewComment = {
        id: 123,
        body: 'Some feedback.\n\n**Prompt for AI Agents:** Fix the type safety issue',
        user: { id: 1, login: 'coderabbitai', type: 'Bot', avatar_url: '', html_url: '' },
        path: 'test.ts',
        position: 1,
        line: 10,
        commit_id: 'abc',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        html_url: 'https://example.com',
        pull_request_url: 'https://example.com',
    };

    beforeEach(() => {
        mockDb = {
            storeCodeRabbitAnalysis: mock(() => {}),
        } as unknown as DatabaseService;
        service = new CodeRabbitService(mockDb);
    });

    describe('isCodeRabbitComment', () => {
        it('should identify CodeRabbit comments', () => {
            expect(service.isCodeRabbitComment(mockCodeRabbitComment)).toBe(true);
        });

        it('should reject non-CodeRabbit comments', () => {
            const userComment = {
                ...mockCodeRabbitComment,
                user: { ...mockCodeRabbitComment.user, login: 'user', type: 'User' as const },
            };
            expect(service.isCodeRabbitComment(userComment)).toBe(false);
        });
    });

    describe('extractAIPrompt', () => {
        it('should extract AI prompt', () => {
            const result = service.extractAIPrompt(mockCodeRabbitComment.body);
            expect(result.found).toBe(true);
            expect(result.prompt).toBe('Fix the type safety issue');
        });

        it('should handle missing prompts', () => {
            const result = service.extractAIPrompt('Regular comment');
            expect(result.found).toBe(false);
            expect(result.prompt).toBe(null);
        });
    });

    describe('analyzeComment', () => {
        it('should analyze CodeRabbit comment', () => {
            const result = service.analyzeComment(mockCodeRabbitComment);
            expect(result).not.toBeNull();
            expect(result?.commentId).toBe(123);
            expect(result?.aiPrompt).toBe('Fix the type safety issue');
        });

        it('should return null for non-CodeRabbit comments', () => {
            const userComment = {
                ...mockCodeRabbitComment,
                user: { ...mockCodeRabbitComment.user, login: 'user' },
            };
            const result = service.analyzeComment(userComment);
            expect(result).toBeNull();
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid comment structure', () => {
            const invalidComment = null as unknown as GitHubReviewComment;
            expect(() => service.analyzeComment(invalidComment)).toThrow(CommentParsingError);
        });

        it('should handle malformed comment body', () => {
            const malformedComment = {
                ...mockCodeRabbitComment,
                body: null as unknown as string,
            };
            expect(() => service.extractAIPrompt(malformedComment.body)).toThrow(CommentParsingError);
        });

        it('should handle missing comment properties', () => {
            const incompleteComment = {
                id: 123,
                body: 'test',
                // missing user property
            } as unknown as GitHubReviewComment;
            expect(service.isCodeRabbitComment(incompleteComment)).toBe(false);
        });
    });

    describe('Database Integration', () => {
        it('should store analysis in database when analyzing comment', () => {
            const result = service.analyzeComment(mockCodeRabbitComment);
            expect(mockDb.storeCodeRabbitAnalysis).toHaveBeenCalledWith(result);
        });

        it('should handle database errors gracefully', () => {
            const mockStore = mockDb.storeCodeRabbitAnalysis as unknown as ReturnType<typeof mock>;
            mockStore.mockImplementation(() => {
                throw new Error('Database error');
            });

            expect(() => service.analyzeComment(mockCodeRabbitComment)).toThrow(CodeRabbitError);
        });
    });

    describe('processComments', () => {
        it('should process multiple comments with some failures', () => {
            const comments = [
                mockCodeRabbitComment,
                null as unknown as GitHubReviewComment, // This should fail
                { ...mockCodeRabbitComment, id: 456 },
            ];

            const results = service.processComments(comments);
            expect(results).toHaveLength(2); // Only valid comments processed
        });
    });
});
