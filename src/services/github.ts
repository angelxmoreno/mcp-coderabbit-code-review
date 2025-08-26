import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'; // Fix: type imports
import { config } from '../config';
import { AuthenticationError } from '../errors/github/AuthenticationError';
import { GitHubError } from '../errors/github/GitHubError';
import { NotFoundError } from '../errors/github/NotFoundError';
import { RateLimitError } from '../errors/github/RateLimitError';
import type {
    CreateCommentRequest,
    GitHubComment,
    GitHubPullRequest,
    GitHubReviewComment,
    GraphQLResponse,
    UpdateCommentRequest,
} from '../types/github';
import { logger } from '../utils/logger';
import type { DatabaseService } from './database'; // Import DatabaseService

interface RateLimitInfo {
    // Moved from src/types/github.ts
    limit: number;
    remaining: number;
    reset: number;
    used: number;
}

export class GitHubService {
    protected readonly token: string;
    protected readonly baseUrl: string;
    protected readonly graphqlUrl: string;
    protected readonly timeout: number;
    protected readonly maxRetries: number;
    protected readonly retryDelay: number;
    protected circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
    protected consecutiveFailures = 0;
    protected readonly maxConsecutiveFailures = 5;
    protected lastFailureTime = 0;
    protected readonly circuitBreakerTimeout = 60000; // 1 minute
    protected readonly axiosInstance: AxiosInstance; // Axios instance

    constructor(token?: string) {
        this.token = token || this.getTokenFromEnv();
        this.baseUrl = config.github.baseUrl;
        this.graphqlUrl = config.github.graphqlUrl;
        this.timeout = config.github.timeout;
        this.maxRetries = config.github.maxRetries;
        this.retryDelay = config.github.retryDelay;

        this.validateToken();
        logger.info('GitHub service initialized');

        this.axiosInstance = axios.create({
            baseURL: this.baseUrl,
            timeout: this.timeout,
            headers: this.getDefaultHeaders(),
        });
    }

    protected getTokenFromEnv(): string {
        const token = Bun.env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;
        if (!token) {
            throw new AuthenticationError('GitHub token not found in environment variables');
        }
        return token;
    }

    protected validateToken(): void {
        if (!this.token.startsWith('ghp_') && !this.token.startsWith('github_pat_')) {
            logger.warn('GitHub token format may be invalid');
        }

        if (this.token.length < 40) {
            throw new AuthenticationError('GitHub token appears to be invalid (too short)');
        }

        logger.info('GitHub token validated');
    }

    public async validateConnection(): Promise<boolean> {
        try {
            await this.makeRequest<{ login: string }>('/user', { method: 'GET' });
            logger.info('GitHub connection validated successfully');
            return true;
        } catch (error) {
            logger.error({ error }, 'GitHub connection validation failed');
            return false;
        }
    }

    protected async checkRateLimit(response: AxiosResponse): Promise<void> {
        const rateLimitInfo = this.getRateLimitInfo(response);

        logger.debug({ rateLimitInfo }, 'Rate limit status');

        if (rateLimitInfo.remaining < config.github.rateLimit.warningThreshold) {
            logger.warn(
                { remaining: rateLimitInfo.remaining, reset: rateLimitInfo.reset },
                'GitHub API rate limit approaching'
            );
        }

        if (rateLimitInfo.remaining === 0) {
            const resetTime = rateLimitInfo.reset * 1000; // Convert to milliseconds
            const waitTime = resetTime - Date.now();

            if (waitTime > 0) {
                logger.warn({ waitTime }, 'Rate limit exceeded, waiting for reset');
                await this.waitForRateLimit(resetTime);
            }
        }
    }

    protected async waitForRateLimit(resetTime: number): Promise<void> {
        const waitTime = resetTime - Date.now();
        if (waitTime > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitTime + 1000)); // Add 1s buffer
        }
    }

    protected getRateLimitInfo(response: AxiosResponse): RateLimitInfo {
        return {
            limit: parseInt(response.headers['x-ratelimit-limit'] || '5000', 10),
            remaining: parseInt(response.headers['x-ratelimit-remaining'] || '5000', 10),
            reset: parseInt(response.headers['x-ratelimit-reset'] || '0', 10),
            used: parseInt(response.headers['x-ratelimit-used'] || '0', 10),
        };
    }

    protected checkCircuitBreaker(): void {
        const now = Date.now();

        if (this.circuitBreakerState === 'open') {
            if (now - this.lastFailureTime > this.circuitBreakerTimeout) {
                this.circuitBreakerState = 'half-open';
                logger.info('Circuit breaker moved to half-open state');
            } else {
                throw new GitHubError('Circuit breaker is open - GitHub API unavailable');
            }
        }
    }

    protected recordSuccess(): void {
        if (this.circuitBreakerState === 'half-open') {
            this.circuitBreakerState = 'closed';
            this.consecutiveFailures = 0;
            logger.info('Circuit breaker closed - GitHub API recovered');
        } else if (this.circuitBreakerState === 'closed') {
            this.consecutiveFailures = 0;
        }
    }

    protected recordFailure(): void {
        this.consecutiveFailures++;
        this.lastFailureTime = Date.now();

        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            this.circuitBreakerState = 'open';
            logger.error({ failures: this.consecutiveFailures }, 'Circuit breaker opened - GitHub API unavailable');
        }
    }

    protected async makeRequest<T>(
        endpoint: string,
        options: AxiosRequestConfig & { retries?: number } = {}
    ): Promise<T> {
        this.checkCircuitBreaker();

        const { retries = 0, ...axiosConfig } = options;
        const url = `${this.baseUrl}${endpoint}`;

        try {
            logger.debug({ url, method: axiosConfig.method || 'GET' }, 'Making GitHub API request');

            const response = await this.axiosInstance.request<T>({
                url: endpoint,
                ...axiosConfig,
                headers: {
                    ...this.getDefaultHeaders(),
                    ...axiosConfig.headers,
                },
            });

            await this.checkRateLimit(response);

            this.recordSuccess();
            return response.data;
        } catch (error) {
            logger.error({ error, url, attempt: retries + 1 }, 'GitHub API request failed');

            if (this.shouldRetry(error as AxiosError, retries)) {
                const delay = this.getRetryDelay(retries);
                logger.info({ delay, attempt: retries + 1 }, 'Retrying GitHub API request');

                await new Promise((resolve) => setTimeout(resolve, delay));
                return this.makeRequest<T>(endpoint, { ...options, retries: retries + 1 });
            }

            this.recordFailure();
            throw this.handleAxiosError(error as AxiosError);
        }
    }

    protected handleAxiosError(error: AxiosError): GitHubError {
        if (error.response) {
            const { status, statusText } = error.response;
            if (status === 401) {
                return new AuthenticationError('GitHub token is invalid or expired', { cause: error });
            }
            if (status === 403) {
                const remaining = error.response.headers['x-ratelimit-remaining'];
                if (remaining === '0') {
                    return new RateLimitError('GitHub API rate limit exceeded', undefined, { cause: error });
                }
                return new GitHubError(`GitHub API access forbidden: ${status} ${statusText}`, { cause: error });
            }
            if (status === 404) {
                return new NotFoundError('resource', { cause: error });
            }
            return new GitHubError(`GitHub API error: ${status} ${statusText}`, { cause: error });
        } else if (error.request) {
            return new GitHubError('No response received from GitHub API', { cause: error });
        }
        return new GitHubError('Error setting up GitHub API request', { cause: error });
    }

    protected shouldRetry(error: AxiosError, attempt: number): boolean {
        if (attempt >= this.maxRetries) return false;

        if (error.response && error.response.status === 401) return false;

        if (error.response && error.response.status >= 400 && error.response.status < 500) {
            return error.response.status === 403 && error.response.headers['x-ratelimit-remaining'] === '0';
        }

        return true;
    }

    protected getRetryDelay(attempt: number): number {
        const baseDelay = this.retryDelay;
        const exponentialDelay = baseDelay * 2 ** attempt;
        const jitter = Math.random() * 0.1 * exponentialDelay;
        return Math.min(exponentialDelay + jitter, 30000);
    }

    protected getDefaultHeaders(): Record<string, string> {
        return {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': config.github.userAgent,
            'Content-Type': 'application/json',
        };
    }

    public async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
        const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}`;

        try {
            const pr = await this.makeRequest<GitHubPullRequest>(endpoint, { method: 'GET' });
            logger.info({ owner, repo, prNumber, title: pr.title }, 'Retrieved pull request');
            return pr;
        } catch (error) {
            logger.error({ error, owner, repo, prNumber }, 'Failed to get pull request');
            throw new GitHubError(`Failed to get pull request ${owner}/${repo}#${prNumber}`, { cause: error });
        }
    }

    public async getPullRequestComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]> {
        const endpoint = `/repos/${owner}/${repo}/issues/${prNumber}/comments`;
        try {
            const comments = await this.makeRequest<GitHubComment[]>(endpoint, { method: 'GET' });
            logger.info({ owner, repo, prNumber, count: comments.length }, 'Retrieved pull request comments');
            return comments;
        } catch (error) {
            logger.error({ error, owner, repo, prNumber }, 'Failed to get pull request comments');
            throw new GitHubError(`Failed to get pull request comments for ${owner}/${repo}#${prNumber}`, {
                cause: error,
            });
        }
    }

    public async getReviewComments(owner: string, repo: string, prNumber: number): Promise<GitHubReviewComment[]> {
        const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`;

        try {
            const comments = await this.makeRequest<GitHubReviewComment[]>(endpoint, { method: 'GET' });
            logger.info({ owner, repo, prNumber, count: comments.length }, 'Retrieved review comments');
            return comments;
        } catch (error) {
            logger.error({ error, owner, repo, prNumber }, 'Failed to get review comments');
            throw new GitHubError(`Failed to get review comments for ${owner}/${repo}#${prNumber}`, { cause: error });
        }
    }

    public async createComment(
        owner: string,
        repo: string,
        prNumber: number,
        comment: CreateCommentRequest
    ): Promise<GitHubComment> {
        const endpoint = `/repos/${owner}/${repo}/issues/${prNumber}/comments`;

        try {
            const newComment = await this.makeRequest<GitHubComment>(endpoint, {
                method: 'POST',
                data: comment,
            });
            logger.info({ owner, repo, prNumber, commentId: newComment.id }, 'Created comment');
            return newComment;
        } catch (error) {
            logger.error({ error, owner, repo, prNumber, comment }, 'Failed to create comment');
            throw new GitHubError(`Failed to create comment on ${owner}/${repo}#${prNumber}`, { cause: error });
        }
    }

    public async replyToComment(owner: string, repo: string, commentId: number, reply: string): Promise<GitHubComment> {
        const endpoint = `/repos/${owner}/${repo}/pulls/comments`;

        const data = {
            body: reply,
            in_reply_to: commentId,
        };

        try {
            const comment = await this.makeRequest<GitHubComment>(endpoint, {
                method: 'POST',
                data: data,
            });

            logger.info({ owner, repo, commentId, replyId: comment.id }, 'Created reply to comment');
            return comment;
        } catch (error) {
            logger.error({ error, owner, repo, commentId }, 'Failed to reply to comment');
            throw new GitHubError(`Failed to reply to comment ${commentId}`, { cause: error });
        }
    }

    public async updateComment(
        owner: string,
        repo: string,
        commentId: number,
        updates: UpdateCommentRequest
    ): Promise<GitHubComment> {
        const endpoint = `/repos/${owner}/${repo}/pulls/comments/${commentId}`;
        try {
            const updatedComment = await this.makeRequest<GitHubComment>(endpoint, {
                method: 'PATCH',
                data: updates,
            });
            logger.info({ owner, repo, commentId, updates }, 'Updated comment');
            return updatedComment;
        } catch (error) {
            logger.error({ error, owner, repo, commentId, updates }, 'Failed to update comment');
            throw new GitHubError(`Failed to update comment ${commentId}`, { cause: error });
        }
    }

    public async resolveReviewThread(_owner: string, _repo: string, threadId: string): Promise<boolean> {
        const query = `
            mutation ResolveReviewThread($threadId: String!) {
                resolveReviewThread(input: { threadId: $threadId }) {
                    thread {
                        id
                        isResolved
                    }
                }
            }
        `;
        const variables = { threadId };

        try {
            const result = await this.executeGraphQL<{
                resolveReviewThread: { thread: { id: string; isResolved: boolean } };
            }>(query, variables);

            if (result.resolveReviewThread.thread.isResolved) {
                logger.info({ threadId }, 'Review thread resolved');
                return true;
            } else {
                logger.warn({ threadId }, 'Failed to resolve review thread');
                return false;
            }
        } catch (error) {
            logger.error({ error, threadId }, 'Failed to resolve review thread via GraphQL');
            throw new GitHubError(`Failed to resolve review thread ${threadId}`, { cause: error });
        }
    }

    protected async executeGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        const data = { query, variables };
        try {
            const response = await this.axiosInstance.post<GraphQLResponse<T>>(this.graphqlUrl, data, {
                baseURL: undefined,
                headers: this.getDefaultHeaders(),
            });

            const result = response.data;

            if (result.errors && result.errors.length > 0) {
                const graphqlError = result.errors[0];
                if (graphqlError) {
                    logger.error({ graphqlError }, 'GraphQL error response');
                    throw new GitHubError(`GraphQL error: ${graphqlError.message}`, { cause: graphqlError });
                }
            }

            if (!result.data) {
                throw new GitHubError('GraphQL response data is empty');
            }

            return result.data;
        } catch (error) {
            logger.error({ error }, 'GraphQL request failed');
            throw new GitHubError(`GraphQL request failed`, { cause: error });
        }
    }

    protected buildUrl(endpoint: string, params: Record<string, string>): string {
        let url = endpoint;
        for (const key in params) {
            const value = params[key];
            if (value !== undefined) {
                url = url.replace(`{${key}}`, value);
            }
        }
        return url;
    }

    protected isCodeRabbitComment(comment: GitHubReviewComment): boolean {
        return (
            comment.user?.login === 'coderabbitai' ||
            (comment.user?.type === 'Bot' && comment.body.includes('Prompt for AI Agents:'))
        );
    }

    protected extractPromptMetadata(commentBody: string): string | null {
        const promptMatch = commentBody.match(/Prompt for AI Agents:\s*(.+?)(?:\n|$)/);
        return promptMatch?.[1] ? promptMatch[1].trim() : null;
    }

    public async syncPrComments(
        databaseService: DatabaseService,
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<{ synced: number; new: number; updated: number }> {
        try {
            let pr = databaseService.getPr(`${owner}/${repo}`, prNumber);
            if (!pr) {
                pr = databaseService.createPr(`${owner}/${repo}`, prNumber);
            }

            const reviewComments = await this.getReviewComments(owner, repo, prNumber);

            const coderabbitComments = reviewComments.filter((comment) => this.isCodeRabbitComment(comment));

            let newComments = 0;
            let updatedComments = 0;

            for (const comment of coderabbitComments) {
                const existingComment = databaseService.getComment(comment.id);

                if (!existingComment) {
                    const promptMetadata = this.extractPromptMetadata(comment.body);
                    databaseService.createComment({
                        pr_id: pr.id,
                        file: comment.path,
                        line: comment.line,
                        author: comment.user.login,
                        original_comment: comment.body,
                        prompt_for_ai_agents: promptMetadata,
                    });
                    newComments++;
                } else {
                    if (existingComment.original_comment !== comment.body) {
                        const promptMetadata = this.extractPromptMetadata(comment.body);
                        databaseService.updateComment(comment.id, {
                            original_comment: comment.body,
                            prompt_for_ai_agents: promptMetadata,
                        });
                        updatedComments++;
                    }
                }
            }

            databaseService.updatePrLastSynced(pr.id, new Date().toISOString());

            const result = {
                synced: coderabbitComments.length,
                new: newComments,
                updated: updatedComments,
            };

            logger.info(result, 'PR comments sync completed');
            return result;
        } catch (error) {
            logger.error({ error, owner, repo, prNumber }, 'Failed to sync PR comments');
            throw new GitHubError('Failed to sync PR comments', { cause: error });
        }
    }
}
