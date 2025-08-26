# GitHub API Service Implementation Guide

## Overview

This document provides detailed instructions for implementing the GitHub API Service as outlined in section 4 of the project tasks. The service will integrate with GitHub's REST and GraphQL APIs to handle PR comment operations, following the patterns established in the Database Service implementation.

## Prerequisites for Junior Developers

Before starting, ensure you understand:
- GitHub REST API and GraphQL API basics
- HTTP client patterns (fetch, error handling, retries)
- Rate limiting and authentication with Personal Access Tokens
- Async/await patterns and Promise handling
- Error handling with custom error classes
- TypeScript interfaces for API responses

## Quick Reference - GitHub API Basics

### **Authentication**
```typescript
// Headers for GitHub API requests
const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MCP-CodeRabbit-Server/1.0.0'
};
```

### **Rate Limiting**
```typescript
// GitHub API rate limit headers to check
const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
const rateLimitReset = response.headers.get('x-ratelimit-reset');
const rateLimitUsed = response.headers.get('x-ratelimit-used');
```

### **Common API Endpoints**
```typescript
// REST API endpoints we'll use
const endpoints = {
    pullRequest: '/repos/{owner}/{repo}/pulls/{pull_number}',
    comments: '/repos/{owner}/{repo}/pulls/{pull_number}/comments',
    reviewComments: '/repos/{owner}/{repo}/pulls/{pull_number}/reviews',
    createComment: '/repos/{owner}/{repo}/pulls/{pull_number}/comments',
    updateComment: '/repos/{owner}/{repo}/pulls/comments/{comment_id}',
    resolveThread: '/repos/{owner}/{repo}/pulls/comments/{comment_id}' // GraphQL
};
```

## Task Breakdown

### 1. Update Config File for GitHub API Service

**Location**: `src/config.ts`

Add GitHub API specific configuration:

```typescript
export const config: Config = {
    env,
    isDevelopment,
    database: {
        // existing database config
    },
    github: {
        baseUrl: 'https://api.github.com',
        graphqlUrl: 'https://api.github.com/graphql',
        userAgent: 'MCP-CodeRabbit-Server/1.0.0',
        timeout: 10000,
        maxRetries: 3,
        retryDelay: 1000,
        rateLimit: {
            maxRequests: 5000, // Per hour
            warningThreshold: 100 // Warn when remaining requests < 100
        }
    }
};
```

**Location**: `src/types/config.ts`

Update the Config type:

```typescript
export type Config = {
    env: NODE_ENV;
    isDevelopment: boolean;
    database: {
        // existing database config
    };
    github: {
        baseUrl: string;
        graphqlUrl: string;
        userAgent: string;
        timeout: number;
        maxRetries: number;
        retryDelay: number;
        rateLimit: {
            maxRequests: number;
            warningThreshold: number;
        };
    };
};
```

### 2. GitHub API Service Implementation

**Location**: `src/services/github.ts`

The service must implement GitHub API integration following the overview document requirements and leverage proper error handling, rate limiting, and retry logic.

#### Core Requirements

1. **Authentication**: GitHub Personal Access Token validation and usage
2. **Rate Limiting**: Respect GitHub API limits with exponential backoff
3. **Error Handling**: Comprehensive error handling with retry logic
4. **Circuit Breaker**: Fail fast when GitHub consistently unavailable
5. **Type Safety**: Full TypeScript integration with GitHub API types
6. **Logging**: Structured logging for all operations and errors

#### Service Structure

```typescript
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';
import { GitHubError, RateLimitError, AuthenticationError } from '../errors/github.ts';
import type { 
    GitHubPullRequest,
    GitHubComment,
    GitHubReviewComment,
    CreateCommentRequest,
    UpdateCommentRequest,
    GitHubApiResponse
} from '../types/github.ts';

export class GitHubService {
    private readonly token: string;
    private readonly baseUrl: string;
    private readonly graphqlUrl: string;
    private readonly timeout: number;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
    private consecutiveFailures = 0;
    private readonly maxConsecutiveFailures = 5;
    private lastFailureTime = 0;
    private readonly circuitBreakerTimeout = 60000; // 1 minute

    constructor(token?: string) {
        this.token = token || this.getTokenFromEnv();
        this.baseUrl = config.github.baseUrl;
        this.graphqlUrl = config.github.graphqlUrl;
        this.timeout = config.github.timeout;
        this.maxRetries = config.github.maxRetries;
        this.retryDelay = config.github.retryDelay;
        
        this.validateToken();
    }

    // Authentication & Validation
    private getTokenFromEnv(): string;
    private validateToken(): void;
    public async validateConnection(): Promise<boolean>;

    // Rate Limiting
    private async checkRateLimit(response: Response): Promise<void>;
    private async waitForRateLimit(resetTime: number): Promise<void>;
    private getRateLimitInfo(response: Response): RateLimitInfo;

    // Circuit Breaker
    private checkCircuitBreaker(): void;
    private recordSuccess(): void;
    private recordFailure(): void;

    // HTTP Client
    private async makeRequest<T>(
        endpoint: string, 
        options: RequestInit & { retries?: number }
    ): Promise<T>;
    private async handleResponse<T>(response: Response): Promise<T>;
    private shouldRetry(error: Error, attempt: number): boolean;
    private getRetryDelay(attempt: number): number;

    // PR Operations
    public async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest>;
    public async getPullRequestComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]>;
    public async getReviewComments(owner: string, repo: string, prNumber: number): Promise<GitHubReviewComment[]>;

    // Comment Operations
    public async createComment(
        owner: string, 
        repo: string, 
        prNumber: number, 
        comment: CreateCommentRequest
    ): Promise<GitHubComment>;
    
    public async replyToComment(
        owner: string,
        repo: string,
        commentId: number,
        reply: string
    ): Promise<GitHubComment>;

    public async updateComment(
        owner: string,
        repo: string,
        commentId: number,
        updates: UpdateCommentRequest
    ): Promise<GitHubComment>;

    // GraphQL Operations
    public async resolveReviewThread(
        owner: string,
        repo: string,
        threadId: string
    ): Promise<boolean>;

    private async executeGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T>;

    // Utility Methods
    private buildUrl(endpoint: string, params: Record<string, string>): string;
    private getDefaultHeaders(): Record<string, string>;
}
```

#### Complete Implementation Examples

##### 1. Constructor and Authentication

```typescript
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';
import { GitHubError, RateLimitError, AuthenticationError } from '../errors/github.ts';

export class GitHubService {
    private readonly token: string;
    private readonly baseUrl: string;
    private readonly graphqlUrl: string;
    private readonly timeout: number;
    private readonly maxRetries: number;
    private readonly retryDelay: number;
    private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
    private consecutiveFailures = 0;
    private readonly maxConsecutiveFailures = 5;
    private lastFailureTime = 0;
    private readonly circuitBreakerTimeout = 60000;

    constructor(token?: string) {
        this.token = token || this.getTokenFromEnv();
        this.baseUrl = config.github.baseUrl;
        this.graphqlUrl = config.github.graphqlUrl;
        this.timeout = config.github.timeout;
        this.maxRetries = config.github.maxRetries;
        this.retryDelay = config.github.retryDelay;
        
        this.validateToken();
        logger.info('GitHub service initialized');
    }

    private getTokenFromEnv(): string {
        const token = process.env.GITHUB_TOKEN || Bun.env.GITHUB_TOKEN;
        if (!token) {
            throw new AuthenticationError('GitHub token not found in environment variables');
        }
        return token;
    }

    private validateToken(): void {
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
}
```

##### 2. Rate Limiting Implementation

```typescript
interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
}

private async checkRateLimit(response: Response): Promise<void> {
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

private async waitForRateLimit(resetTime: number): Promise<void> {
    const waitTime = resetTime - Date.now();
    if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 1000)); // Add 1s buffer
    }
}

private getRateLimitInfo(response: Response): RateLimitInfo {
    return {
        limit: parseInt(response.headers.get('x-ratelimit-limit') || '5000'),
        remaining: parseInt(response.headers.get('x-ratelimit-remaining') || '5000'),
        reset: parseInt(response.headers.get('x-ratelimit-reset') || '0'),
        used: parseInt(response.headers.get('x-ratelimit-used') || '0')
    };
}
```

##### 3. Circuit Breaker Pattern

```typescript
private checkCircuitBreaker(): void {
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

private recordSuccess(): void {
    if (this.circuitBreakerState === 'half-open') {
        this.circuitBreakerState = 'closed';
        this.consecutiveFailures = 0;
        logger.info('Circuit breaker closed - GitHub API recovered');
    } else if (this.circuitBreakerState === 'closed') {
        this.consecutiveFailures = 0;
    }
}

private recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();
    
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.circuitBreakerState = 'open';
        logger.error(
            { failures: this.consecutiveFailures },
            'Circuit breaker opened - GitHub API unavailable'
        );
    }
}
```

##### 4. HTTP Client with Retry Logic

```typescript
private async makeRequest<T>(
    endpoint: string, 
    options: RequestInit & { retries?: number } = {}
): Promise<T> {
    this.checkCircuitBreaker();
    
    const { retries = 0, ...fetchOptions } = options;
    const url = `${this.baseUrl}${endpoint}`;
    
    const requestOptions: RequestInit = {
        ...fetchOptions,
        headers: {
            ...this.getDefaultHeaders(),
            ...fetchOptions.headers,
        },
        signal: AbortSignal.timeout(this.timeout),
    };

    try {
        logger.debug({ url, method: fetchOptions.method || 'GET' }, 'Making GitHub API request');
        
        const response = await fetch(url, requestOptions);
        
        // Check rate limiting before processing response
        await this.checkRateLimit(response);
        
        const result = await this.handleResponse<T>(response);
        this.recordSuccess();
        return result;
        
    } catch (error) {
        logger.error({ error, url, attempt: retries + 1 }, 'GitHub API request failed');
        
        if (this.shouldRetry(error as Error, retries)) {
            const delay = this.getRetryDelay(retries);
            logger.info({ delay, attempt: retries + 1 }, 'Retrying GitHub API request');
            
            await new Promise(resolve => setTimeout(resolve, delay));
            return this.makeRequest<T>(endpoint, { ...options, retries: retries + 1 });
        }
        
        this.recordFailure();
        throw error;
    }
}

private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
        throw new AuthenticationError('GitHub token is invalid or expired');
    }
    
    if (response.status === 403) {
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining === '0') {
            throw new RateLimitError('GitHub API rate limit exceeded');
        }
        throw new GitHubError(`GitHub API access forbidden: ${response.statusText}`);
    }
    
    if (response.status === 404) {
        throw new GitHubError('GitHub resource not found', { cause: { status: 404 } });
    }
    
    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new GitHubError(
            `GitHub API error: ${response.status} ${response.statusText}`,
            { cause: { status: response.status, body: errorText } }
        );
    }
    
    try {
        return await response.json();
    } catch (error) {
        throw new GitHubError('Failed to parse GitHub API response', { cause: error });
    }
}

private shouldRetry(error: Error, attempt: number): boolean {
    if (attempt >= this.maxRetries) return false;
    
    // Don't retry authentication errors
    if (error instanceof AuthenticationError) return false;
    
    // Don't retry 4xx errors except rate limiting
    if (error instanceof GitHubError && error.cause?.status >= 400 && error.cause?.status < 500) {
        return error instanceof RateLimitError;
    }
    
    // Retry network errors and 5xx errors
    return true;
}

private getRetryDelay(attempt: number): number {
    // Exponential backoff: base delay * 2^attempt + jitter
    const baseDelay = this.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
}

private getDefaultHeaders(): Record<string, string> {
    return {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': config.github.userAgent,
        'Content-Type': 'application/json',
    };
}
```

##### 5. API Operations Implementation

```typescript
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

public async getReviewComments(owner: string, repo: string, prNumber: number): Promise<GitHubReviewComment[]> {
    const endpoint = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
    
    try {
        const comments = await this.makeRequest<GitHubReviewComment[]>(endpoint, { method: 'GET' });
        logger.info(
            { owner, repo, prNumber, count: comments.length }, 
            'Retrieved review comments'
        );
        return comments;
    } catch (error) {
        logger.error({ error, owner, repo, prNumber }, 'Failed to get review comments');
        throw new GitHubError(`Failed to get review comments for ${owner}/${repo}#${prNumber}`, { cause: error });
    }
}

public async replyToComment(
    owner: string,
    repo: string,
    commentId: number,
    reply: string
): Promise<GitHubComment> {
    const endpoint = `/repos/${owner}/${repo}/pulls/comments`;
    
    const body = {
        body: reply,
        in_reply_to: commentId
    };

    try {
        const comment = await this.makeRequest<GitHubComment>(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        logger.info(
            { owner, repo, commentId, replyId: comment.id },
            'Created reply to comment'
        );
        return comment;
    } catch (error) {
        logger.error({ error, owner, repo, commentId }, 'Failed to reply to comment');
        throw new GitHubError(`Failed to reply to comment ${commentId}`, { cause: error });
    }
}
```

### 3. Error Classes

**Location**: `src/errors/github.ts`

Create GitHub-specific error classes:

```typescript
/// <reference lib="es2022.error" />

export class GitHubError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'GitHubError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class AuthenticationError extends GitHubError {
    constructor(message: string = 'GitHub authentication failed') {
        super(message);
        this.name = 'AuthenticationError';
    }
}

export class RateLimitError extends GitHubError {
    constructor(message: string = 'GitHub API rate limit exceeded', public resetTime?: number) {
        super(message);
        this.name = 'RateLimitError';
    }
}

export class NotFoundError extends GitHubError {
    constructor(resource: string) {
        super(`GitHub resource not found: ${resource}`);
        this.name = 'NotFoundError';
    }
}
```

### 4. GitHub Types

**Location**: `src/types/github.ts`

Complete TypeScript type definitions based on GitHub API:

```typescript
// GitHub API Response Types
export interface GitHubPullRequest {
    id: number;
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed' | 'merged';
    user: GitHubUser;
    head: GitHubBranch;
    base: GitHubBranch;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    html_url: string;
}

export interface GitHubUser {
    id: number;
    login: string;
    avatar_url: string;
    html_url: string;
    type: 'User' | 'Bot';
}

export interface GitHubBranch {
    ref: string;
    sha: string;
    repo: {
        id: number;
        name: string;
        full_name: string;
        owner: GitHubUser;
    };
}

export interface GitHubComment {
    id: number;
    body: string;
    user: GitHubUser;
    created_at: string;
    updated_at: string;
    html_url: string;
    issue_url?: string;
    pull_request_url?: string;
}

export interface GitHubReviewComment {
    id: number;
    body: string;
    user: GitHubUser;
    path: string;
    position: number | null;
    line: number | null;
    commit_id: string;
    created_at: string;
    updated_at: string;
    html_url: string;
    pull_request_url: string;
    in_reply_to_id?: number;
}

// Request Types
export interface CreateCommentRequest {
    body: string;
    path?: string;
    line?: number;
    side?: 'LEFT' | 'RIGHT';
    start_line?: number;
    start_side?: 'LEFT' | 'RIGHT';
    in_reply_to?: number;
}

export interface UpdateCommentRequest {
    body: string;
}

// Response wrapper for paginated results
export interface GitHubApiResponse<T> {
    data: T;
    headers: Record<string, string>;
    status: number;
}

// GraphQL Types
export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{
        message: string;
        path?: string[];
        extensions?: Record<string, unknown>;
    }>;
}

export interface ResolveThreadMutation {
    resolveReviewThread: {
        thread: {
            id: string;
            isResolved: boolean;
        };
    };
}
```

### 5. Write Tests

**Location**: `tests/unit/services/github.test.ts`

Comprehensive test suite with mocking:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { GitHubService } from '../../../src/services/github.ts';
import { GitHubError, AuthenticationError, RateLimitError } from '../../../src/errors/github.ts';

// Mock fetch globally
const mockFetch = mock();
global.fetch = mockFetch;

describe('GitHubService', () => {
    let githubService: GitHubService;
    const testToken = 'ghp_test_token_1234567890abcdefghijklmnopqrstuvwxyz';
    
    beforeEach(() => {
        mockFetch.mockClear();
        process.env.GITHUB_TOKEN = testToken;
        githubService = new GitHubService();
    });
    
    afterEach(() => {
        delete process.env.GITHUB_TOKEN;
    });

    describe('Constructor and Authentication', () => {
        it('should initialize with provided token', () => {
            const customToken = 'ghp_custom_token_1234567890abcdefghijklmnopqrstuvwxyz';
            const service = new GitHubService(customToken);
            expect(service).toBeInstanceOf(GitHubService);
        });

        it('should throw error when no token provided', () => {
            delete process.env.GITHUB_TOKEN;
            expect(() => new GitHubService()).toThrow(AuthenticationError);
        });

        it('should validate token format', () => {
            expect(() => new GitHubService('invalid_token')).toThrow(AuthenticationError);
        });

        it('should validate connection successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({
                    'x-ratelimit-remaining': '4999',
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
                }),
                json: async () => ({ login: 'testuser' })
            });

            const isValid = await githubService.validateConnection();
            expect(isValid).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('Rate Limiting', () => {
        it('should handle rate limit exceeded', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 403,
                headers: new Headers({
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1)
                }),
                text: async () => 'API rate limit exceeded'
            });

            await expect(
                githubService.getPullRequest('owner', 'repo', 123)
            ).rejects.toThrow(RateLimitError);
        });

        it('should warn when approaching rate limit', async () => {
            const loggerSpy = spyOn(console, 'warn');
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({
                    'x-ratelimit-remaining': '50', // Below warning threshold
                    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600)
                }),
                json: async () => ({ id: 123, number: 123, title: 'Test PR' })
            });

            await githubService.getPullRequest('owner', 'repo', 123);
            // Verify warning was logged (implementation detail)
        });
    });

    describe('Circuit Breaker', () => {
        it('should open circuit after consecutive failures', async () => {
            // Mock 5 consecutive failures
            for (let i = 0; i < 5; i++) {
                mockFetch.mockResolvedValueOnce({
                    ok: false,
                    status: 500,
                    text: async () => 'Internal Server Error'
                });

                try {
                    await githubService.getPullRequest('owner', 'repo', 123);
                } catch (error) {
                    // Expected to fail
                }
            }

            // 6th request should fail immediately due to open circuit
            await expect(
                githubService.getPullRequest('owner', 'repo', 123)
            ).rejects.toThrow('Circuit breaker is open');
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
            head: { ref: 'feature', sha: 'abc123', repo: { id: 1, name: 'repo', full_name: 'owner/repo', owner: { id: 1, login: 'owner', avatar_url: '', html_url: '', type: 'User' as const } } },
            base: { ref: 'main', sha: 'def456', repo: { id: 1, name: 'repo', full_name: 'owner/repo', owner: { id: 1, login: 'owner', avatar_url: '', html_url: '', type: 'User' as const } } },
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            merged_at: null,
            html_url: 'https://github.com/owner/repo/pull/123'
        };

        it('should get pull request successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({
                    'x-ratelimit-remaining': '4999'
                }),
                json: async () => mockPR
            });

            const pr = await githubService.getPullRequest('owner', 'repo', 123);
            expect(pr).toEqual(mockPR);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.github.com/repos/owner/repo/pulls/123',
                expect.objectContaining({
                    method: 'GET',
                    headers: expect.objectContaining({
                        'Authorization': `Bearer ${testToken}`
                    })
                })
            );
        });

        it('should handle PR not found', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => 'Not Found'
            });

            await expect(
                githubService.getPullRequest('owner', 'repo', 999)
            ).rejects.toThrow(GitHubError);
        });
    });

    describe('Comment Operations', () => {
        const mockComment = {
            id: 456,
            body: 'Test comment',
            user: { id: 1, login: 'testuser', avatar_url: '', html_url: '', type: 'User' as const },
            created_at: '2023-01-01T00:00:00Z',
            updated_at: '2023-01-01T00:00:00Z',
            html_url: 'https://github.com/owner/repo/pull/123#issuecomment-456'
        };

        it('should get review comments successfully', async () => {
            const mockComments = [mockComment];
            
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({
                    'x-ratelimit-remaining': '4999'
                }),
                json: async () => mockComments
            });

            const comments = await githubService.getReviewComments('owner', 'repo', 123);
            expect(comments).toEqual(mockComments);
        });

        it('should reply to comment successfully', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 201,
                headers: new Headers({
                    'x-ratelimit-remaining': '4999'
                }),
                json: async () => mockComment
            });

            const reply = await githubService.replyToComment('owner', 'repo', 123, 'Test reply');
            expect(reply).toEqual(mockComment);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.github.com/repos/owner/repo/pulls/comments',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        body: 'Test reply',
                        in_reply_to: 123
                    })
                })
            );
        });
    });

    describe('Error Handling', () => {
        it('should retry on network errors', async () => {
            // First call fails with network error
            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            
            // Second call succeeds
            mockFetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                headers: new Headers({
                    'x-ratelimit-remaining': '4999'
                }),
                json: async () => ({ login: 'testuser' })
            });

            const isValid = await githubService.validateConnection();
            expect(isValid).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should not retry authentication errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: async () => 'Unauthorized'
            });

            await expect(
                githubService.validateConnection()
            ).rejects.toThrow(AuthenticationError);
            
            expect(mockFetch).toHaveBeenCalledTimes(1); // No retry
        });
    });
});
```

### 6. Integration with Database Service

**Location**: `src/services/github.ts` (additional methods)

Add methods that integrate with the database service for CodeRabbit workflow:

```typescript
import { DatabaseService } from './database.ts';

export class GitHubService {
    // ... existing implementation

    /**
     * Syncs PR comments from GitHub API to database
     * Filters for CodeRabbit comments with "Prompt for AI Agents" metadata
     */
    public async syncPrComments(
        databaseService: DatabaseService,
        owner: string,
        repo: string,
        prNumber: number
    ): Promise<{ synced: number; new: number; updated: number }> {
        try {
            // Get or create PR in database
            let pr = databaseService.getPr(`${owner}/${repo}`, prNumber);
            if (!pr) {
                pr = databaseService.createPr(`${owner}/${repo}`, prNumber);
            }

            // Get comments from GitHub
            const reviewComments = await this.getReviewComments(owner, repo, prNumber);
            
            // Filter for CodeRabbit comments
            const coderabbitComments = reviewComments.filter(comment => 
                this.isCodeRabbitComment(comment)
            );

            let newComments = 0;
            let updatedComments = 0;

            for (const comment of coderabbitComments) {
                const existingComment = databaseService.getComment(comment.id);
                
                if (!existingComment) {
                    // Create new comment
                    const promptMetadata = this.extractPromptMetadata(comment.body);
                    databaseService.createComment({
                        pr_id: pr.id,
                        file: comment.path,
                        line: comment.line,
                        author: comment.user.login,
                        original_comment: comment.body,
                        prompt_for_ai_agents: promptMetadata
                    });
                    newComments++;
                } else {
                    // Update existing comment if needed
                    if (existingComment.original_comment !== comment.body) {
                        const promptMetadata = this.extractPromptMetadata(comment.body);
                        databaseService.updateComment(comment.id, {
                            original_comment: comment.body,
                            prompt_for_ai_agents: promptMetadata
                        });
                        updatedComments++;
                    }
                }
            }

            // Update PR sync timestamp
            databaseService.updatePrLastSynced(pr.id, new Date().toISOString());

            const result = {
                synced: coderabbitComments.length,
                new: newComments,
                updated: updatedComments
            };

            logger.info(result, 'PR comments sync completed');
            return result;

        } catch (error) {
            logger.error({ error, owner, repo, prNumber }, 'Failed to sync PR comments');
            throw new GitHubError('Failed to sync PR comments', { cause: error });
        }
    }

    /**
     * Checks if a comment is from CodeRabbit with AI agent metadata
     */
    private isCodeRabbitComment(comment: GitHubReviewComment): boolean {
        return comment.user.login === 'coderabbitai' || 
               comment.user.type === 'Bot' && 
               comment.body.includes('Prompt for AI Agents:');
    }

    /**
     * Extracts the "Prompt for AI Agents" metadata from comment body
     */
    private extractPromptMetadata(commentBody: string): string | null {
        const promptMatch = commentBody.match(/Prompt for AI Agents:\s*(.+?)(?:\n|$)/);
        return promptMatch ? promptMatch[1].trim() : null;
    }
}
```

## Common Pitfalls and Solutions

### 1. Token Security
**Problem**: Hardcoding tokens or logging sensitive data
```typescript
// ❌ Wrong - token in logs
logger.info({ token: this.token }, 'Using token');

// ✅ Correct - mask sensitive data
logger.info({ tokenPrefix: this.token.substring(0, 7) + '...' }, 'Using token');
```

### 2. Rate Limit Handling
**Problem**: Not respecting GitHub's rate limits
```typescript
// ❌ Wrong - ignoring rate limit headers
const response = await fetch(url, options);
return response.json();

// ✅ Correct - check and respect rate limits
const response = await fetch(url, options);
await this.checkRateLimit(response);
return response.json();
```

### 3. Error Context Loss
**Problem**: Losing error context during re-throws
```typescript
// ❌ Wrong - loses original error
throw new GitHubError('Failed to get PR');

// ✅ Correct - preserves error context
throw new GitHubError('Failed to get PR', { cause: error });
```

### 4. Async/Await Misuse
**Problem**: Not properly handling Promise rejections
```typescript
// ❌ Wrong - unhandled promise rejection
const promises = comments.map(comment => this.processComment(comment));
const results = await Promise.all(promises); // Can fail all if one fails

// ✅ Correct - handle individual failures
const results = await Promise.allSettled(
    comments.map(comment => this.processComment(comment))
);
```

## Debug Tips

### 1. Request/Response Logging
```typescript
if (config.isDevelopment) {
    logger.debug({
        url,
        method: options.method,
        headers: this.getDefaultHeaders()
    }, 'GitHub API request');
}
```

### 2. Rate Limit Monitoring
```typescript
private logRateLimitStatus(response: Response): void {
    const rateLimitInfo = this.getRateLimitInfo(response);
    if (rateLimitInfo.remaining < 100) {
        logger.warn({ rateLimitInfo }, 'Low rate limit remaining');
    }
}
```

### 3. Circuit Breaker State Logging
```typescript
private logCircuitBreakerState(): void {
    logger.debug({
        state: this.circuitBreakerState,
        consecutiveFailures: this.consecutiveFailures,
        lastFailureTime: this.lastFailureTime
    }, 'Circuit breaker status');
}
```

## Success Criteria

- [ ] All tests pass with `bun test`
- [ ] TypeScript compilation succeeds with `bun run typecheck`  
- [ ] Linting passes with `bun run lint`
- [ ] Service integrates properly with config system
- [ ] Authentication works with GitHub Personal Access Tokens
- [ ] Rate limiting is properly implemented and respected
- [ ] Circuit breaker prevents cascading failures
- [ ] Error handling covers all GitHub API scenarios
- [ ] Retry logic works for transient failures
- [ ] All CRUD operations for comments work correctly
- [ ] GraphQL integration works for resolving threads
- [ ] Memory usage is reasonable (< 100MB for typical workloads)

## Final Checklist for Junior Developers

Before submitting your implementation:

1. **Authentication & Security**
   - [ ] Token validation is comprehensive
   - [ ] No tokens logged or exposed
   - [ ] Proper error messages without sensitive data
   - [ ] Environment variable handling works

2. **GitHub API Integration**
   - [ ] All required endpoints are implemented
   - [ ] Request headers are correct and complete
   - [ ] Response parsing handles all expected formats
   - [ ] Error responses are properly handled

3. **Rate Limiting & Resilience**
   - [ ] Rate limit headers are checked and respected
   - [ ] Exponential backoff retry logic works
   - [ ] Circuit breaker opens/closes correctly
   - [ ] Timeout handling prevents hanging requests

4. **Testing**
   - [ ] All public methods have tests
   - [ ] Error conditions are tested with mocks
   - [ ] Rate limiting scenarios are covered
   - [ ] Circuit breaker behavior is tested

5. **Integration**
   - [ ] Config system integration works
   - [ ] Logger integration provides useful information
   - [ ] Error classes follow established patterns
   - [ ] Type definitions are complete and accurate

6. **Performance**
   - [ ] Requests complete within timeout limits
   - [ ] Memory usage is stable under load
   - [ ] Concurrent requests are handled properly
   - [ ] No memory leaks in long-running operations

Run these commands to verify everything works:
```bash
bun run typecheck
bun run lint  
bun test tests/unit/services/github.test.ts
GITHUB_TOKEN=your_token_here bun run src/scripts/test-github-connection.ts
```

## Key Learnings Applied from Database Service

1. **Error Handling**: Use modern ErrorOptions with proper cause chaining
2. **Type Safety**: No `any` types, comprehensive TypeScript coverage
3. **Testing**: Extensive unit tests with proper mocking
4. **Logging**: Structured logging with appropriate context
5. **Config Integration**: Use centralized configuration system
6. **Code Quality**: Follow established patterns and conventions
7. **Documentation**: Clear comments explaining complex logic