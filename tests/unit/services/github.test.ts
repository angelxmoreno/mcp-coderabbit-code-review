import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';

import { config } from '../../../src/config';
import { AuthenticationError } from '../../../src/errors/github/AuthenticationError';
import { GitHubError } from '../../../src/errors/github/GitHubError';
import type { DatabaseService } from '../../../src/services/database';
import { GitHubService } from '../../../src/services/github';
import type { CommentRecord } from '../../../src/types/database';
import { logger } from '../../../src/utils/logger';

// Test interface to access protected/private methods and properties
interface GitHubServiceTestInterface {
    getRetryDelay: (attempt: number) => number;
    circuitBreakerState: 'closed' | 'half-open' | 'open';
    consecutiveFailures: number;
    circuitBreakerTimeout: number;
}

describe('GitHubService', () => {
    let githubService: GitHubService;
    let mockAxios: MockAdapter;
    const testToken = 'ghp_test_token_1234567890abcdefghijklmnopqrstuvwxyz';

    beforeEach(() => {
        mockAxios = new MockAdapter(axios);
        githubService = new GitHubService(testToken);
    });

    afterEach(() => {
        mockAxios.restore();
    });

    describe('Constructor and Authentication', () => {
        it('should initialize with provided token', () => {
            const customToken = 'ghp_custom_token_1234567890abcdefghijklmnopqrstuvwxyz';
            const service = new GitHubService(customToken);
            expect(service).toBeInstanceOf(GitHubService);
        });

        it('should throw error when no token provided', () => {
            expect(() => new GitHubService()).toThrow(AuthenticationError);
        });

        it('should validate token format', () => {
            expect(() => new GitHubService('invalid_token')).toThrow(AuthenticationError);
        });

        it('should validate connection successfully', async () => {
            mockAxios.onGet('/user').reply(
                200,
                { login: 'testuser' },
                {
                    'x-ratelimit-remaining': '4999',
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
                }
            );

            const isValid = await githubService.validateConnection();
            expect(isValid).toBe(true);
            expect(mockAxios.history.get.length).toBe(1);
        });

        it('should handle connection validation failure', async () => {
            mockAxios.onGet('/user').reply(401, 'Unauthorized');

            const isValid = await githubService.validateConnection();
            expect(isValid).toBe(false);
            expect(mockAxios.history.get.length).toBe(1);
        });
    });

    describe('Rate Limiting', () => {
        it('should handle rate limit exceeded', async () => {
            // Override getRetryDelay to avoid actual delays in tests
            const testService = githubService as unknown as GitHubServiceTestInterface;
            const originalGetRetryDelay = testService.getRetryDelay;
            testService.getRetryDelay = () => 1; // 1ms delay for testing

            try {
                // Mock 403 response with rate limit exceeded - this should be retried until maxRetries
                mockAxios.onGet('/repos/owner/repo/pulls/123').reply(403, 'API rate limit exceeded', {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1),
                });

                // The RateLimitError gets wrapped by getPullRequest
                expect(githubService.getPullRequest('owner', 'repo', 123)).rejects.toThrow(
                    'Failed to get pull request owner/repo#123'
                );
            } finally {
                // Restore original method
                testService.getRetryDelay = originalGetRetryDelay;
            }
        });

        it('should warn when approaching rate limit', async () => {
            const loggerSpy = spyOn(logger, 'warn');
            mockAxios.onGet('/repos/owner/repo/pulls/123').replyOnce(
                200,
                { id: 123, number: 123, title: 'Test PR' },
                {
                    'x-ratelimit-remaining': String(config.github.rateLimit.warningThreshold - 1),
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
                }
            );

            await githubService.getPullRequest('owner', 'repo', 123);
            expect(loggerSpy).toHaveBeenCalledWith(
                expect.objectContaining({ remaining: config.github.rateLimit.warningThreshold - 1 }),
                'GitHub API rate limit approaching'
            );
            loggerSpy.mockRestore();
        });
    });

    describe('Circuit Breaker', () => {
        it('should open circuit after consecutive failures', async () => {
            // Mock 500 errors that will be retried and eventually exhaust maxRetries (3)
            mockAxios.onGet('/repos/owner/repo/pulls/123').reply(500, 'Internal Server Error');

            // Override getRetryDelay to avoid actual delays in tests
            const testService = githubService as unknown as GitHubServiceTestInterface;
            const originalGetRetryDelay = testService.getRetryDelay;
            testService.getRetryDelay = () => 1; // 1ms delay for testing

            try {
                // Each request will fail after exhausting retries (maxRetries=3), incrementing consecutive failures
                // Need maxConsecutiveFailures (5) to open circuit
                for (let i = 0; i < 5; i++) {
                    try {
                        await githubService.getPullRequest('owner', 'repo', 123);
                    } catch (_error) {
                        // Expected to fail after retries
                    }
                }

                // Check if circuit breaker is actually open
                expect(testService.circuitBreakerState).toBe('open');
                expect(testService.consecutiveFailures).toBeGreaterThanOrEqual(5);

                // Circuit should now be open - next request should fail immediately
                // The circuit breaker error gets wrapped by getPullRequest
                expect(githubService.getPullRequest('owner', 'repo', 123)).rejects.toThrow(
                    'Failed to get pull request owner/repo#123'
                );
            } finally {
                // Restore original method
                testService.getRetryDelay = originalGetRetryDelay;
            }
        });

        it('should close circuit after successful request in half-open state', async () => {
            // Override getRetryDelay to avoid actual delays in tests
            const testService = githubService as unknown as GitHubServiceTestInterface;
            const originalGetRetryDelay = testService.getRetryDelay;
            testService.getRetryDelay = () => 1; // 1ms delay for testing

            try {
                // Force circuit to open by exhausting retries with 500 errors
                mockAxios.onGet('/repos/owner/repo/pulls/123').reply(500, 'Internal Server Error');
                for (let i = 0; i < 5; i++) {
                    try {
                        await githubService.getPullRequest('owner', 'repo', 123);
                    } catch (_e) {
                        /* expected */
                    }
                }

                // Advance time to half-open state
                const originalDateNow = Date.now;
                Date.now = () => originalDateNow() + testService.circuitBreakerTimeout + 1;

                // First request in half-open state succeeds
                mockAxios.reset();
                mockAxios.onGet('/repos/owner/repo/pulls/123').replyOnce(
                    200,
                    { id: 123, number: 123, title: 'Test PR' },
                    {
                        'x-ratelimit-remaining': '4999',
                    }
                );

                await githubService.getPullRequest('owner', 'repo', 123);

                // Subsequent request should not throw circuit breaker error
                mockAxios.onGet('/repos/owner/repo/pulls/124').replyOnce(
                    200,
                    { id: 124, number: 124, title: 'Another PR' },
                    {
                        'x-ratelimit-remaining': '4999',
                    }
                );

                expect(githubService.getPullRequest('owner', 'repo', 124)).resolves.toBeDefined();
                Date.now = originalDateNow;
            } finally {
                // Restore original method
                testService.getRetryDelay = originalGetRetryDelay;
            }
        });
    });

    describe('PR Operations', () => {
        const mockPR = {
            id: 123,
            number: 123,
            title: 'Test PR',
            body: 'Test description',
            state: 'open' as const,
            user: { id: 1, login: 'testuser', avatar_url: '', html_url: '', type: 'User' as const },
            head: {
                ref: 'feature',
                sha: 'abc123',
                repo: {
                    id: 1,
                    name: 'repo',
                    full_name: 'owner/repo',
                    owner: { id: 1, login: 'owner', avatar_url: '', html_url: '', type: 'User' as const },
                },
            },
            base: {
                ref: 'main',
                sha: 'def456',
                repo: {
                    id: 1,
                    name: 'repo',
                    full_name: 'owner/repo',
                    owner: { id: 1, login: 'owner', avatar_url: '', html_url: '', type: 'User' as const },
                },
            },
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            merged_at: null,
            html_url: 'https://github.com/owner/repo/pull/123',
        };

        it('should get pull request successfully', async () => {
            mockAxios.onGet('/repos/owner/repo/pulls/123').replyOnce(200, mockPR, {
                'x-ratelimit-remaining': '4999',
            });

            const pr = await githubService.getPullRequest('owner', 'repo', 123);
            expect(pr).toEqual(mockPR);
            expect(mockAxios.history.get.length).toBeGreaterThan(0);
            expect(mockAxios.history.get[0]?.url).toBe('/repos/owner/repo/pulls/123');
            expect(mockAxios.history.get[0]?.headers?.Authorization).toBe(`Bearer ${testToken}`);
        });

        it('should handle PR not found', async () => {
            mockAxios.onGet('/repos/owner/repo/pulls/999').replyOnce(404, 'Not Found');

            expect(githubService.getPullRequest('owner', 'repo', 999)).rejects.toThrow(
                'Failed to get pull request owner/repo#999'
            );
        });

        it('should get pull request comments successfully', async () => {
            const mockComments = [
                {
                    id: 1,
                    body: 'comment',
                    user: mockPR.user,
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                },
            ];

            mockAxios.onGet('/repos/owner/repo/issues/123/comments').replyOnce(200, mockComments, {
                'x-ratelimit-remaining': '4999',
            });

            const comments = await githubService.getPullRequestComments('owner', 'repo', 123);
            expect(comments).toEqual(mockComments);
        });

        it('should get review comments successfully', async () => {
            const mockReviewComments = [
                {
                    id: 1,
                    body: 'review comment',
                    user: mockPR.user,
                    path: 'file.ts',
                    position: 1,
                    line: 1,
                    commit_id: 'abc',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
            ];

            mockAxios.onGet('/repos/owner/repo/pulls/123/comments').replyOnce(200, mockReviewComments, {
                'x-ratelimit-remaining': '4999',
            });

            const comments = await githubService.getReviewComments('owner', 'repo', 123);
            expect(comments).toEqual(mockReviewComments);
        });
    });

    describe('Comment Operations', () => {
        const mockComment = {
            id: 456,
            body: 'Test comment',
            user: { id: 1, login: 'testuser', avatar_url: '', html_url: '', type: 'User' as const },
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-456',
        };

        it('should create comment successfully', async () => {
            const createRequest = { body: 'New comment' };

            mockAxios.onPost('/repos/owner/repo/issues/123/comments').replyOnce(201, mockComment, {
                'x-ratelimit-remaining': '4999',
            });

            const newComment = await githubService.createComment('owner', 'repo', 123, createRequest);
            expect(newComment).toEqual(mockComment);
            expect(mockAxios.history.post.length).toBeGreaterThan(0);
            expect(mockAxios.history.post[0]?.url).toBe('/repos/owner/repo/issues/123/comments');
            expect(JSON.parse(mockAxios.history.post[0]?.data)).toEqual(createRequest);
        });

        it('should reply to comment successfully', async () => {
            mockAxios.onPost('/repos/owner/repo/pulls/comments').replyOnce(201, mockComment, {
                'x-ratelimit-remaining': '4999',
            });

            const reply = await githubService.replyToComment('owner', 'repo', 123, 'Test reply');
            expect(reply).toEqual(mockComment);
            expect(mockAxios.history.post.length).toBeGreaterThan(0);
            expect(mockAxios.history.post[0]?.url).toBe('/repos/owner/repo/pulls/comments');
            expect(JSON.parse(mockAxios.history.post[0]?.data)).toEqual({
                body: 'Test reply',
                in_reply_to: 123,
            });
        });

        it('should update comment successfully', async () => {
            const updateRequest = { body: 'Updated comment' };

            mockAxios.onPatch('/repos/owner/repo/pulls/comments/456').replyOnce(
                200,
                { ...mockComment, body: 'Updated comment' },
                {
                    'x-ratelimit-remaining': '4999',
                }
            );

            const updatedComment = await githubService.updateComment('owner', 'repo', 456, updateRequest);
            expect(updatedComment.body).toBe('Updated comment');
            expect(mockAxios.history.patch.length).toBeGreaterThan(0);
            expect(mockAxios.history.patch[0]?.url).toBe('/repos/owner/repo/pulls/comments/456');
            expect(JSON.parse(mockAxios.history.patch[0]?.data)).toEqual(updateRequest);
        });
    });

    describe('GraphQL Operations', () => {
        it('should resolve review thread successfully', async () => {
            const mockGraphQLResponse = {
                data: {
                    resolveReviewThread: {
                        thread: {
                            id: 'MDIxOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMjYwOTQ1NjQ=',
                            isResolved: true,
                        },
                    },
                },
            };

            mockAxios.onPost(config.github.graphqlUrl).replyOnce(200, mockGraphQLResponse, {
                'x-ratelimit-remaining': '4999',
            });

            const resolved = await githubService.resolveReviewThread(
                'owner',
                'repo',
                'MDIxOlB1bGxSZXF1ZXN0UmV2aWV3VGhyZWFkMjYwOTQ1NjQ='
            );
            expect(resolved).toBe(true);
            expect(mockAxios.history.post.length).toBeGreaterThan(0);
            expect(mockAxios.history.post[0]?.url).toBe(config.github.graphqlUrl);
            expect(JSON.parse(mockAxios.history.post[0]?.data).query).toContain('mutation ResolveReviewThread');
        });

        it('should handle GraphQL error response', async () => {
            const mockGraphQLResponse = {
                errors: [{ message: 'Something went wrong', extensions: {} }],
            };

            mockAxios.onPost(config.github.graphqlUrl).replyOnce(200, mockGraphQLResponse, {
                'x-ratelimit-remaining': '4999',
            });

            expect(githubService.resolveReviewThread('owner', 'repo', 'some-thread-id')).rejects.toThrow(
                'Failed to resolve review thread some-thread-id'
            );
        });
    });

    describe('Error Handling', () => {
        it('should retry on network errors', async () => {
            // First call fails with network error
            mockAxios.onGet('/user').networkErrorOnce();
            // Second call succeeds
            mockAxios.onGet('/user').replyOnce(
                200,
                { login: 'testuser' },
                {
                    'x-ratelimit-remaining': '4999',
                }
            );

            const isValid = await githubService.validateConnection();
            expect(isValid).toBe(true);
            expect(mockAxios.history.get.length).toBe(2);
        });

        it('should not retry authentication errors', async () => {
            mockAxios.onGet('/user').reply(401, 'Unauthorized');

            const result = await githubService.validateConnection();
            expect(result).toBe(false);
            expect(mockAxios.history.get.length).toBe(1); // Should not retry 401 errors
        });

        it('should throw GitHubError for generic API errors', async () => {
            mockAxios.onGet('/repos/owner/repo/pulls/123').replyOnce(500, 'Internal Server Error');

            expect(githubService.getPullRequest('owner', 'repo', 123)).rejects.toThrow(GitHubError);
        });
    });

    describe('syncPrComments', () => {
        // Mock DatabaseService
        const mockDatabaseService = {
            getPr: mock((repoFullName: string, prNumber: number) => {
                if (repoFullName === 'owner/repo' && prNumber === 123) {
                    return { id: 1, repo: 'owner/repo', number: 123, last_synced: null };
                }
                return null;
            }),
            createPr: mock((repoFullName: string, prNumber: number) => ({
                id: 1,
                repo: repoFullName,
                number: prNumber,
                last_synced: null,
            })),
            getComment: mock((id: number) => {
                if (id === 1) {
                    return {
                        id: 1,
                        pr_id: 1,
                        file: 'file.ts',
                        line: 1,
                        author: 'coderabbitai',
                        original_comment: 'Old CodeRabbit comment\nPrompt for AI Agents: old prompt',
                        prompt_for_ai_agents: 'old prompt',
                        agreement: null,
                        reply: null,
                        replied: false,
                        fix_applied: false,
                        created_at: '',
                        reviewed_at: null,
                        fixed_at: null,
                    } as CommentRecord;
                }
                return null;
            }),
            createComment: mock(() => {}),
            updateComment: mock(() => {}),
            updatePrLastSynced: mock(() => {}),
        };

        beforeEach(() => {
            mockDatabaseService.getPr.mockClear();
            mockDatabaseService.createPr.mockClear();
            mockDatabaseService.getComment.mockClear();
            mockDatabaseService.createComment.mockClear();
            mockDatabaseService.updateComment.mockClear();
            mockDatabaseService.updatePrLastSynced.mockClear();
        });

        it('should sync new CodeRabbit comments', async () => {
            // Clear previous mocks
            mockDatabaseService.getPr.mockClear();
            mockDatabaseService.createPr.mockClear();
            mockDatabaseService.getComment.mockClear();
            mockDatabaseService.createComment.mockClear();
            mockDatabaseService.updateComment.mockClear();
            mockDatabaseService.updatePrLastSynced.mockClear();

            // For this test, make getPr return null so createPr gets called
            mockDatabaseService.getPr.mockReturnValueOnce(null);

            const mockReviewComments = [
                {
                    id: 1,
                    body: 'Some regular comment',
                    user: { login: 'user', type: 'User' },
                    path: 'file.ts',
                    line: 1,
                    commit_id: 'abc',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
                {
                    id: 2,
                    body: 'CodeRabbit comment\nPrompt for AI Agents: test prompt',
                    user: { login: 'coderabbitai', type: 'Bot' },
                    path: 'file.ts',
                    line: 2,
                    commit_id: 'def',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
                {
                    id: 3,
                    body: 'Another CodeRabbit comment\nPrompt for AI Agents: another prompt',
                    user: { login: 'anotherbot', type: 'Bot' },
                    path: 'file.ts',
                    line: 3,
                    commit_id: 'ghi',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
            ];

            mockAxios.onGet('/repos/owner/repo/pulls/123/comments').replyOnce(200, mockReviewComments, {
                'x-ratelimit-remaining': '4999',
            });

            const result = await githubService.syncPrComments(
                mockDatabaseService as unknown as DatabaseService,
                'owner',
                'repo',
                123
            );

            expect(result.synced).toBe(2);
            expect(result.new).toBe(2);
            expect(result.updated).toBe(0);
            expect(mockDatabaseService.createPr).toHaveBeenCalledTimes(1);
            expect(mockDatabaseService.createComment).toHaveBeenCalledTimes(2);
            expect(mockDatabaseService.createComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    pr_id: 1,
                    original_comment: 'CodeRabbit comment\nPrompt for AI Agents: test prompt',
                    prompt_for_ai_agents: 'test prompt',
                })
            );
            expect(mockDatabaseService.createComment).toHaveBeenCalledWith(
                expect.objectContaining({
                    pr_id: 1,
                    original_comment: 'Another CodeRabbit comment\nPrompt for AI Agents: another prompt',
                    prompt_for_ai_agents: 'another prompt',
                })
            );
            expect(mockDatabaseService.updatePrLastSynced).toHaveBeenCalledTimes(1);
        });

        it('should update existing CodeRabbit comments', async () => {
            const mockReviewComments = [
                {
                    id: 1,
                    body: 'Updated CodeRabbit comment\nPrompt for AI Agents: updated prompt',
                    user: { login: 'coderabbitai', type: 'Bot' },
                    path: 'file.ts',
                    line: 1,
                    commit_id: 'abc',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
            ];

            mockDatabaseService.getComment.mockReturnValueOnce({
                id: 1,
                pr_id: 1,
                file: 'file.ts',
                line: 1,
                author: 'coderabbitai',
                original_comment: 'Old CodeRabbit comment\nPrompt for AI Agents: old prompt',
                prompt_for_ai_agents: 'old prompt',
                agreement: null,
                reply: null,
                replied: false,
                fix_applied: false,
                created_at: '',
                reviewed_at: null,
                fixed_at: null,
            } as CommentRecord);

            mockAxios.onGet('/repos/owner/repo/pulls/123/comments').replyOnce(200, mockReviewComments, {
                'x-ratelimit-remaining': '4999',
            });

            const result = await githubService.syncPrComments(
                mockDatabaseService as unknown as DatabaseService,
                'owner',
                'repo',
                123
            );

            expect(result.synced).toBe(1);
            expect(result.new).toBe(0);
            expect(result.updated).toBe(1);
            expect(mockDatabaseService.updateComment).toHaveBeenCalledTimes(1);
            expect(mockDatabaseService.updateComment).toHaveBeenCalledWith(1, {
                original_comment: 'Updated CodeRabbit comment\nPrompt for AI Agents: updated prompt',
                prompt_for_ai_agents: 'updated prompt',
            });
        });

        it('should not update comments if body is unchanged', async () => {
            const mockReviewComments = [
                {
                    id: 1,
                    body: 'Unchanged comment\nPrompt for AI Agents: same prompt',
                    user: { login: 'coderabbitai', type: 'Bot' },
                    path: 'file.ts',
                    line: 1,
                    commit_id: 'abc',
                    created_at: '',
                    updated_at: '',
                    html_url: '',
                    pull_request_url: '',
                },
            ];

            mockDatabaseService.getComment.mockReturnValueOnce({
                id: 1,
                pr_id: 1,
                file: 'file.ts',
                line: 1,
                author: 'coderabbitai',
                original_comment: 'Unchanged comment\nPrompt for AI Agents: same prompt',
                prompt_for_ai_agents: 'same prompt',
                agreement: null,
                reply: null,
                replied: false,
                fix_applied: false,
                created_at: '',
                reviewed_at: null,
                fixed_at: null,
            } as CommentRecord);

            mockAxios.onGet('/repos/owner/repo/pulls/123/comments').replyOnce(200, mockReviewComments, {
                'x-ratelimit-remaining': '4999',
            });

            const result = await githubService.syncPrComments(
                mockDatabaseService as unknown as DatabaseService,
                'owner',
                'repo',
                123
            );

            expect(result.synced).toBe(1);
            expect(result.new).toBe(0);
            expect(result.updated).toBe(0);
            expect(mockDatabaseService.updateComment).not.toHaveBeenCalled();
        });

        it('should handle errors during sync', async () => {
            mockAxios.onGet('/repos/owner/repo/pulls/123/comments').networkErrorOnce();

            expect(
                githubService.syncPrComments(mockDatabaseService as unknown as DatabaseService, 'owner', 'repo', 123)
            ).rejects.toThrow(GitHubError);
        });
    });
});
