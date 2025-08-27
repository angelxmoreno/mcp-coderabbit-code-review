# CodeRabbit Service Implementation Guide

## Overview

The CodeRabbit Service extracts "Prompt for AI Agents" metadata from GitHub PR comments. It's a simple parser that looks for CodeRabbit comments and extracts actionable prompts for AI agents.

## What It Does

1. **Identifies CodeRabbit comments** (from user `coderabbitai`)
2. **Extracts AI prompts** from comment text using pattern `**Prompt for AI Agents:** text`
3. **Stores prompts** in the database linked to the original comment

## Task 1: Create CodeRabbit Error Classes

**Location**: `src/errors/coderabbit/CodeRabbitError.ts`

```typescript
export class CodeRabbitError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CodeRabbitError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
```

**Location**: `src/errors/coderabbit/CommentParsingError.ts`

```typescript
import { CodeRabbitError } from './CodeRabbitError';

export class CommentParsingError extends CodeRabbitError {
    constructor(message: string = 'Failed to parse CodeRabbit comment', options?: ErrorOptions) {
        super(message, options);
        this.name = 'CommentParsingError';
    }
}
```

## Task 2: Create CodeRabbit Types

**Location**: `src/types/coderabbit.ts`

```typescript
// Simple types for CodeRabbit service
export interface CodeRabbitAnalysis {
    commentId: number;
    aiPrompt: string | null;
    extractedAt: string;
}

export interface PromptExtractionResult {
    found: boolean;
    prompt: string | null;
}
```

## Task 3: Implement CodeRabbit Service

**Location**: `src/services/coderabbit.ts`

```typescript
import { logger } from '../utils/logger.ts';
import { DatabaseService } from './database.ts';
import { CodeRabbitError, CommentParsingError } from '../errors/coderabbit/index.ts';
import type { GitHubReviewComment } from '../types/github.ts';
import type { CodeRabbitAnalysis, PromptExtractionResult } from '../types/coderabbit.ts';

export class CodeRabbitService {
    constructor(private databaseService: DatabaseService) {
        logger.info('CodeRabbit service initialized');
    }

    // Check if comment is from CodeRabbit
    isCodeRabbitComment(comment: GitHubReviewComment): boolean {
        return comment.user.login === 'coderabbitai' && 
               comment.user.type === 'Bot' &&
               comment.body.includes('**Prompt for AI Agents:**');
    }

    // Extract AI prompt from comment body
    extractAIPrompt(commentBody: string): PromptExtractionResult {
        const match = commentBody.match(/\*\*Prompt for AI Agents:\*\*\s*(.+?)(?:\n|$)/);
        
        if (match && match[1]) {
            return {
                found: true,
                prompt: match[1].trim()
            };
        }
        
        return {
            found: false,
            prompt: null
        };
    }

    // Analyze a single comment
    analyzeComment(comment: GitHubReviewComment): CodeRabbitAnalysis | null {
        if (!this.isCodeRabbitComment(comment)) {
            return null;
        }

        const extraction = this.extractAIPrompt(comment.body);
        
        return {
            commentId: comment.id,
            aiPrompt: extraction.prompt,
            extractedAt: new Date().toISOString()
        };
    }

    // Process multiple comments
    processComments(comments: GitHubReviewComment[]): CodeRabbitAnalysis[] {
        return comments
            .map(comment => this.analyzeComment(comment))
            .filter((analysis): analysis is CodeRabbitAnalysis => analysis !== null);
    }
}
```

## Task 4: Write Tests

**Location**: `tests/unit/services/coderabbit.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'bun:test';
import { CodeRabbitService } from '../../../src/services/coderabbit.ts';
import { DatabaseService } from '../../../src/services/database.ts';
import type { GitHubReviewComment } from '../../../src/types/github.ts';

describe('CodeRabbitService', () => {
    let service: CodeRabbitService;
    let mockDb: DatabaseService;

    const mockCodeRabbitComment: GitHubReviewComment = {
        id: 123,
        body: 'Some feedback.\n\n**Prompt for AI Agents:** Fix the type safety issue',
        user: { id: 1, login: 'coderabbitai', type: 'Bot', avatar_url: '', html_url: '' },
        path: 'test.ts',
        line: 10,
        commit_id: 'abc',
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-01-01T00:00:00Z',
        html_url: 'https://example.com',
        pull_request_url: 'https://example.com'
    };

    beforeEach(() => {
        mockDb = {} as DatabaseService;
        service = new CodeRabbitService(mockDb);
    });

    describe('isCodeRabbitComment', () => {
        it('should identify CodeRabbit comments', () => {
            expect(service.isCodeRabbitComment(mockCodeRabbitComment)).toBe(true);
        });

        it('should reject non-CodeRabbit comments', () => {
            const userComment = { 
                ...mockCodeRabbitComment, 
                user: { ...mockCodeRabbitComment.user, login: 'user', type: 'User' as const }
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
            expect(result!.commentId).toBe(123);
            expect(result!.aiPrompt).toBe('Fix the type safety issue');
        });

        it('should return null for non-CodeRabbit comments', () => {
            const userComment = { 
                ...mockCodeRabbitComment, 
                user: { ...mockCodeRabbitComment.user, login: 'user' }
            };
            const result = service.analyzeComment(userComment);
            expect(result).toBeNull();
        });
    });
});
```

## Database Integration

Add to `src/services/database.ts`:

```typescript
// Add to schema
CREATE TABLE IF NOT EXISTS coderabbit_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    ai_prompt TEXT,
    extracted_at TEXT NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES comment (github_id)
);

// Add method
public storeCodeRabbitAnalysis(analysis: CodeRabbitAnalysis): void {
    if (!this.db) throw new DatabaseError('Database not connected');
    
    this.db.prepare(`
        INSERT INTO coderabbit_analysis (comment_id, ai_prompt, extracted_at)
        VALUES (?, ?, ?)
    `).run(analysis.commentId, analysis.aiPrompt, analysis.extractedAt);
}
```

## Testing & Quality Assurance

Before submitting your implementation, **ALWAYS run `bun check` and fix ALL issues**:

```bash
bun check
```

This command runs TypeScript compilation, linting, and other checks. **Do NOT declare the implementation complete until `bun check` passes with ZERO errors or warnings.**

Common issues you might encounter:
- Missing imports or type definitions
- Unused variables or imports  
- TypeScript type errors
- Linting violations

Fix each issue properly - don't use shortcuts like `any` types or `@ts-ignore` comments.

## Final Checklist

- [ ] All files created with proper imports
- [ ] `bun check` passes with no errors or warnings  
- [ ] Tests pass with `bun test tests/unit/services/coderabbit.test.ts`
- [ ] Database integration works properly
- [ ] Error handling follows established patterns

That's it. Simple, focused, and does exactly what we need.