# Database Service Implementation Guide

## Overview

This document provides detailed instructions for implementing the Database Service as outlined in section 3 of the project tasks. The service will use Bun's native SQLite implementation (`bun:sqlite`) with optimizations for performance, concurrency, and type safety.

## Prerequisites for Junior Developers

Before starting, ensure you understand:
- TypeScript interfaces and classes
- Async/await patterns
- SQL basics (CREATE TABLE, INSERT, SELECT, UPDATE)
- Testing with Bun's test runner
- Error handling with try/catch

## Quick Reference - Bun SQLite Syntax

```typescript
import { Database } from "bun:sqlite";

// Create database connection
const db = new Database("path/to/db.sqlite"); // File database
const db = new Database(":memory:"); // In-memory database

// Execute SQL (no return value)
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");

// Prepare statement for reuse
const stmt = db.prepare("INSERT INTO users (name) VALUES (?)");
const result = stmt.run("John"); // Returns { changes: 1, lastInsertRowid: 1 }

// Query single row
const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
const user = getUser.get(1); // Returns object or null

// Query multiple rows
const getUsers = db.prepare("SELECT * FROM users");
const users = getUsers.all(); // Returns array of objects

// Close database
db.close();
```

## Task Breakdown

### 1. Update Config File for Database Service

**Location**: `src/config.ts`

Add database-specific configuration:

```typescript
export const config: Config = {
    env,
    isDevelopment,
    database: {
        path: '.coderabbit-mcp/state.db',
        walMode: true,
        busyTimeout: 5000,
        journalMode: 'WAL',
        synchronous: 'NORMAL'
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
        path: string;
        walMode: boolean;
        busyTimeout: number;
        journalMode: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
        synchronous: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
    };
};
```

### 2. Database Service Implementation

**Location**: `src/services/database.ts`

The service must implement the database schema from the overview document and leverage Bun's SQLite optimizations.

#### Core Requirements

1. **Schema Implementation**: Implement the exact schema from overview.md
2. **WAL Mode**: Enable Write-Ahead Logging for concurrent reads during writes
3. **Prepared Statements**: Use prepared statements for performance and security
4. **Type Safety**: Leverage Bun's SQLite type safety features
5. **Migration Support**: Use `PRAGMA user_version` for schema versioning
6. **Error Handling**: Proper error handling with custom error types

#### Database Schema (from overview.md)

```sql
CREATE TABLE pr (
  id INTEGER PRIMARY KEY,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  last_synced TEXT
);

CREATE TABLE comment (
  id INTEGER PRIMARY KEY,
  pr_id INTEGER NOT NULL REFERENCES pr(id),
  file TEXT,
  line INTEGER,
  author TEXT,
  original_comment TEXT,
  prompt_for_ai_agents TEXT,
  agreement TEXT CHECK(agreement IN ('yes','no','partially')),
  reply TEXT,
  replied BOOLEAN,
  fix_applied BOOLEAN,
  created_at TEXT,
  reviewed_at TEXT,
  fixed_at TEXT
);
```

#### Service Structure

```typescript
import { Database, type Statement } from "bun:sqlite";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import type { 
    PrRecord, 
    CommentRecord, 
    CommentInsert, 
    CommentUpdate, 
    CommentFilters, 
    PrStats 
} from "../types/database.ts";
import { DatabaseError, NotFoundError } from "../utils/errors.ts";

export class DatabaseService {
    private db: Database | null = null;
    private statements: Record<string, Statement> = {};
    private readonly databasePath: string;

    constructor(databasePath?: string) {
        this.databasePath = databasePath || config.database.path;
    }
    
    // Connection management
    public async connect(): Promise<void>;
    public async close(): Promise<void>;
    
    // Schema management
    private initializeSchema(): void;
    private runMigrations(): void;
    private getCurrentVersion(): number;
    private setVersion(version: number): void;
    
    // PR operations
    public createPr(repo: string, number: number): PrRecord;
    public getPr(repo: string, number: number): PrRecord | null;
    public updatePrLastSynced(id: number, timestamp: string): void;
    public listPrs(repo?: string): PrRecord[];
    
    // Comment operations
    public createComment(commentData: CommentInsert): CommentRecord;
    public getComment(id: number): CommentRecord | null;
    public updateComment(id: number, updates: Partial<CommentUpdate>): void;
    public getCommentsByPr(prId: number, filters?: CommentFilters): CommentRecord[];
    public markCommentReplied(id: number, reply: string): void;
    public markCommentFixed(id: number): void;
    
    // Analytics/reporting
    public getPrStats(prId: number): PrStats;
    
    private prepareStatements(): void;
    private ensureDatabaseDirectory(): void;
}
#### Complete Implementation Examples

Here are complete implementations of key methods to guide junior developers:

##### 1. Constructor and Connection Management

```typescript
import { Database, type Statement } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export class DatabaseService {
    private db: Database | null = null;
    private statements: Record<string, Statement> = {};
    private readonly databasePath: string;

    constructor(databasePath?: string) {
        this.databasePath = databasePath || config.database.path;
    }

    public async connect(): Promise<void> {
        try {
            // Ensure database directory exists
            this.ensureDatabaseDirectory();
            
            // Create database connection
            this.db = new Database(this.databasePath);
            
            // Configure SQLite for optimal performance
            this.db.exec("PRAGMA journal_mode = WAL");
            this.db.exec("PRAGMA synchronous = NORMAL");
            this.db.exec("PRAGMA cache_size = -64000"); // 64MB cache
            this.db.exec("PRAGMA temp_store = MEMORY");
            this.db.exec("PRAGMA mmap_size = 268435456"); // 256MB mmap
            this.db.exec("PRAGMA busy_timeout = 5000");
            
            // Initialize schema and prepare statements
            this.initializeSchema();
            this.runMigrations();
            this.prepareStatements();
            
            logger.info('Database connection established', { path: this.databasePath });
        } catch (error) {
            logger.error('Failed to connect to database', { error, path: this.databasePath });
            throw new DatabaseError(`Failed to connect to database: ${error}`);
        }
    }

    public async close(): Promise<void> {
        if (this.db) {
            try {
                this.db.close();
                this.db = null;
                this.statements = {};
                logger.info('Database connection closed');
            } catch (error) {
                logger.error('Error closing database', { error });
                throw new DatabaseError(`Failed to close database: ${error}`);
            }
        }
    }

    private ensureDatabaseDirectory(): void {
        const dir = dirname(this.databasePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            logger.info('Created database directory', { directory: dir });
        }
    }
}
```

##### 2. Schema Management

```typescript
private initializeSchema(): void {
    if (!this.db) throw new DatabaseError('Database not connected');

    const createTables = `
        CREATE TABLE IF NOT EXISTS pr (
            id INTEGER PRIMARY KEY,
            repo TEXT NOT NULL,
            number INTEGER NOT NULL,
            last_synced TEXT,
            UNIQUE(repo, number)
        );

        CREATE TABLE IF NOT EXISTS comment (
            id INTEGER PRIMARY KEY,
            pr_id INTEGER NOT NULL REFERENCES pr(id) ON DELETE CASCADE,
            file TEXT,
            line INTEGER,
            author TEXT,
            original_comment TEXT,
            prompt_for_ai_agents TEXT,
            agreement TEXT CHECK(agreement IN ('yes','no','partially')),
            reply TEXT,
            replied BOOLEAN DEFAULT FALSE,
            fix_applied BOOLEAN DEFAULT FALSE,
            created_at TEXT DEFAULT (datetime('now')),
            reviewed_at TEXT,
            fixed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pr_repo_number ON pr(repo, number);
        CREATE INDEX IF NOT EXISTS idx_comment_pr_id ON comment(pr_id);
        CREATE INDEX IF NOT EXISTS idx_comment_replied ON comment(replied);
        CREATE INDEX IF NOT EXISTS idx_comment_fix_applied ON comment(fix_applied);
    `;

    this.db.exec(createTables);
    logger.info('Database schema initialized');
}

private runMigrations(): void {
    const currentVersion = this.getCurrentVersion();
    const latestVersion = 1; // Update this when adding new migrations

    if (currentVersion < latestVersion) {
        logger.info('Running database migrations', { from: currentVersion, to: latestVersion });
        
        // Add migration logic here as needed
        // if (currentVersion < 1) {
        //     // Migration code for version 1
        // }
        
        this.setVersion(latestVersion);
        logger.info('Database migrations completed');
    }
}

private getCurrentVersion(): number {
    if (!this.db) throw new DatabaseError('Database not connected');
    const result = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    return result.user_version;
}

private setVersion(version: number): void {
    if (!this.db) throw new DatabaseError('Database not connected');
    this.db.exec(`PRAGMA user_version = ${version}`);
}
```

##### 3. Prepared Statements Setup

```typescript
private prepareStatements(): void {
    if (!this.db) throw new DatabaseError('Database not connected');

    try {
        // PR statements
        this.statements.createPr = this.db.prepare(`
            INSERT INTO pr (repo, number, last_synced) 
            VALUES (?, ?, ?) 
            RETURNING *
        `);
        
        this.statements.getPr = this.db.prepare(`
            SELECT * FROM pr WHERE repo = ? AND number = ?
        `);
        
        this.statements.updatePrLastSynced = this.db.prepare(`
            UPDATE pr SET last_synced = ? WHERE id = ?
        `);
        
        this.statements.listPrs = this.db.prepare(`
            SELECT * FROM pr WHERE (? IS NULL OR repo = ?) ORDER BY number DESC
        `);

        // Comment statements
        this.statements.createComment = this.db.prepare(`
            INSERT INTO comment (
                pr_id, file, line, author, original_comment, 
                prompt_for_ai_agents, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            RETURNING *
        `);
        
        this.statements.getComment = this.db.prepare(`
            SELECT * FROM comment WHERE id = ?
        `);
        
        this.statements.updateComment = this.db.prepare(`
            UPDATE comment 
            SET agreement = ?, reply = ?, replied = ?, fix_applied = ?, 
                reviewed_at = COALESCE(?, reviewed_at),
                fixed_at = COALESCE(?, fixed_at)
            WHERE id = ?
        `);
        
        this.statements.getCommentsByPr = this.db.prepare(`
            SELECT * FROM comment 
            WHERE pr_id = ? 
            AND (? IS NULL OR replied = ?)
            AND (? IS NULL OR fix_applied = ?)
            ORDER BY created_at DESC
        `);
        
        this.statements.markCommentReplied = this.db.prepare(`
            UPDATE comment 
            SET reply = ?, replied = TRUE, reviewed_at = datetime('now')
            WHERE id = ?
        `);
        
        this.statements.markCommentFixed = this.db.prepare(`
            UPDATE comment 
            SET fix_applied = TRUE, fixed_at = datetime('now')
            WHERE id = ?
        `);
        
        this.statements.getPrStats = this.db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN replied = TRUE THEN 1 ELSE 0 END) as replied,
                SUM(CASE WHEN fix_applied = TRUE THEN 1 ELSE 0 END) as fixed,
                GROUP_CONCAT(CASE WHEN replied = FALSE THEN id END) as pending_ids
            FROM comment 
            WHERE pr_id = ?
        `);

        logger.info('Prepared statements created', { count: Object.keys(this.statements).length });
    } catch (error) {
        logger.error('Failed to prepare statements', { error });
        throw new DatabaseError(`Failed to prepare statements: ${error}`);
    }
}
```

##### 4. Example CRUD Operations

```typescript
public createPr(repo: string, number: number): PrRecord {
    if (!this.db || !this.statements.createPr) {
        throw new DatabaseError('Database not connected or statements not prepared');
    }

    try {
        const timestamp = new Date().toISOString();
        const result = this.statements.createPr.get(repo, number, timestamp) as PrRecord;
        
        logger.info('PR created', { id: result.id, repo, number });
        return result;
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            throw new DatabaseError(`PR already exists: ${repo}#${number}`);
        }
        logger.error('Failed to create PR', { error, repo, number });
        throw new DatabaseError(`Failed to create PR: ${error}`);
    }
}

public getPr(repo: string, number: number): PrRecord | null {
    if (!this.db || !this.statements.getPr) {
        throw new DatabaseError('Database not connected or statements not prepared');
    }

    try {
        const result = this.statements.getPr.get(repo, number) as PrRecord | null;
        return result;
    } catch (error) {
        logger.error('Failed to get PR', { error, repo, number });
        throw new DatabaseError(`Failed to get PR: ${error}`);
    }
}

public createComment(commentData: CommentInsert): CommentRecord {
    if (!this.db || !this.statements.createComment) {
        throw new DatabaseError('Database not connected or statements not prepared');
    }

    try {
        const result = this.statements.createComment.get(
            commentData.pr_id,
            commentData.file,
            commentData.line,
            commentData.author,
            commentData.original_comment,
            commentData.prompt_for_ai_agents
        ) as CommentRecord;
        
        logger.info('Comment created', { id: result.id, pr_id: commentData.pr_id });
        return result;
    } catch (error) {
        logger.error('Failed to create comment', { error, commentData });
        throw new DatabaseError(`Failed to create comment: ${error}`);
    }
}
```

#### Bun SQLite Optimizations to Implement

1. **WAL Mode Configuration**:
   ```typescript
   this.db.exec("PRAGMA journal_mode = WAL");
   this.db.exec("PRAGMA synchronous = NORMAL");
   ```

2. **Performance Pragmas**:
   ```typescript
   this.db.exec("PRAGMA cache_size = -64000"); // 64MB cache
   this.db.exec("PRAGMA temp_store = MEMORY");
   this.db.exec("PRAGMA mmap_size = 268435456"); // 256MB mmap
   ```

3. **Prepared Statements for All Operations**:
   - Prepare all SQL statements in constructor
   - Store in `statements` object for reuse
   - Use proper parameter binding

4. **Transaction Support**:
   ```typescript
   public transaction<T>(fn: () => T): T {
       return this.db.transaction(fn)();
   }
   ```

### 3. Database Initialization Script

**Location**: `src/scripts/init-db.ts`

Create a standalone script that can be run to initialize the database:

```typescript
// Script to initialize the database with schema and initial data
// Should be runnable via: bun run src/scripts/init-db.ts

import { DatabaseService } from '../services/database.ts';
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';

async function initializeDatabase() {
    const dbService = new DatabaseService();
    // Implementation details
}

if (import.meta.main) {
    initializeDatabase();
}
```

Add to `package.json` scripts:
```json
{
    "scripts": {
        "db:init": "bun run src/scripts/init-db.ts"
    }
}
```

### 4. Error Classes

**Location**: `src/utils/errors.ts` (update existing file)

Add these error classes for database operations:

```typescript
export class DatabaseError extends Error {
    constructor(message: string, public cause?: unknown) {
        super(message);
        this.name = 'DatabaseError';
    }
}

export class NotFoundError extends Error {
    constructor(resource: string, identifier: string | number) {
        super(`${resource} not found: ${identifier}`);
        this.name = 'NotFoundError';
    }
}

export class ValidationError extends Error {
    constructor(field: string, value: unknown, requirement: string) {
        super(`Invalid ${field}: ${value}. ${requirement}`);
        this.name = 'ValidationError';
    }
}
```

### 5. Database Types

**Location**: `src/types/database.ts`

Complete TypeScript type definitions:

```typescript
// Core database records (exact match to SQL schema)
export interface PrRecord {
    id: number;
    repo: string;
    number: number;
    last_synced: string | null;
}

export interface CommentRecord {
    id: number;
    pr_id: number;
    file: string | null;
    line: number | null;
    author: string | null;
    original_comment: string | null;
    prompt_for_ai_agents: string | null;
    agreement: 'yes' | 'no' | 'partially' | null;
    reply: string | null;
    replied: boolean;
    fix_applied: boolean;
    created_at: string | null;
    reviewed_at: string | null;
    fixed_at: string | null;
}

// Insert types (for creating new records)
export interface PrInsert {
    repo: string;
    number: number;
    last_synced?: string;
}

export interface CommentInsert {
    pr_id: number;
    file?: string | null;
    line?: number | null;
    author?: string | null;
    original_comment?: string | null;
    prompt_for_ai_agents?: string | null;
}

// Update types (for partial updates)
export interface PrUpdate {
    last_synced?: string;
}

export interface CommentUpdate {
    agreement?: 'yes' | 'no' | 'partially' | null;
    reply?: string | null;
    replied?: boolean;
    fix_applied?: boolean;
    reviewed_at?: string | null;
    fixed_at?: string | null;
}

// Filter types for queries
export interface CommentFilters {
    replied?: boolean;
    fix_applied?: boolean;
    agreement?: 'yes' | 'no' | 'partially';
    author?: string;
}

export interface PrFilters {
    repo?: string;
    status?: 'open' | 'all';
}

// Analytics/reporting types
export interface PrStats {
    total: number;
    replied: number;
    fixed: number;
    pending_ids: string | null; // Comma-separated list of IDs
}

// Helper type for parsing pending IDs
export interface PrStatsProcessed extends Omit<PrStats, 'pending_ids'> {
    pending: number[];
}
```

### 6. Write Tests

**Location**: `tests/unit/services/database.test.ts`

Complete test file with examples:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { DatabaseService } from '../../../src/services/database.ts';
import { DatabaseError } from '../../../src/errors/database.ts';
import { NotFoundError } from '../../../src/errors/not-found.ts';
import type { CommentInsert, CommentFilters } from '../../../src/types/database.ts';

describe('DatabaseService', () => {
    let dbService: DatabaseService;
    
    beforeEach(async () => {
        // Use in-memory database for tests
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
            
            // Should be able to perform operations
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
            expect(repo1Prs.every(pr => pr.repo === 'repo1')).toBe(true);
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
                prompt_for_ai_agents: 'Should we use const instead of let here?'
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
                original_comment: 'Test comment'
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
            // Create another PR
            const pr2 = dbService.createPr('test/repo2', 456);
            
            // Create comments for both PRs
            dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });
            dbService.createComment({ pr_id: pr2.id, original_comment: 'Comment 3' });

            const pr1Comments = dbService.getCommentsByPr(prId);
            expect(pr1Comments).toHaveLength(2);
            expect(pr1Comments.every(c => c.pr_id === prId)).toBe(true);

            const pr2Comments = dbService.getCommentsByPr(pr2.id);
            expect(pr2Comments).toHaveLength(1);
        });

        it('should filter comments by replied status', () => {
            const comment1 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            const comment2 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });
            
            // Mark one as replied
            dbService.markCommentReplied(comment1.id, 'This is a reply');

            const filters: CommentFilters = { replied: false };
            const unreplied = dbService.getCommentsByPr(prId, filters);
            expect(unreplied).toHaveLength(1);
            expect(unreplied[0].id).toBe(comment2.id);

            const repliedFilters: CommentFilters = { replied: true };
            const replied = dbService.getCommentsByPr(prId, repliedFilters);
            expect(replied).toHaveLength(1);
            expect(replied[0].id).toBe(comment1.id);
        });

        it('should mark comment as replied', () => {
            const comment = dbService.createComment({ 
                pr_id: prId, 
                original_comment: 'Test comment' 
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
                original_comment: 'Test comment' 
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
            // Create various comments
            const comment1 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 1' });
            const comment2 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 2' });
            const comment3 = dbService.createComment({ pr_id: prId, original_comment: 'Comment 3' });

            // Mark some as replied and fixed
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
        it('should handle invalid PR data', () => {
            // Test empty repo name
            expect(() => {
                dbService.createPr('', 123);
            }).toThrow();
        });

        it('should handle invalid comment data', () => {
            // Test non-existent PR ID
            expect(() => {
                dbService.createComment({ pr_id: 99999, original_comment: 'Test' });
            }).toThrow();
        });

        it('should validate agreement values', () => {
            const pr = dbService.createPr('test/repo', 123);
            const comment = dbService.createComment({ 
                pr_id: pr.id, 
                original_comment: 'Test' 
            });

            // Valid agreement values should work
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
```

### 7. Test Fixtures and Helpers

**Location**: `tests/fixtures/database-fixtures.ts`

Create test data helpers:

```typescript
import type { CommentInsert, PrInsert } from '../../src/types/database.ts';

export const createMockPr = (overrides: Partial<PrInsert> = {}): PrInsert => ({
    repo: 'test/repo',
    number: 123,
    last_synced: new Date().toISOString(),
    ...overrides
});

export const createMockComment = (prId: number, overrides: Partial<CommentInsert> = {}): CommentInsert => ({
    pr_id: prId,
    file: 'src/test.ts',
    line: 10,
    author: 'coderabbit',
    original_comment: 'Consider using const instead of let',
    prompt_for_ai_agents: 'Should we use const instead of let here?',
    ...overrides
});

export const createMockCommentData = () => ({
    simple: { pr_id: 1, original_comment: 'Simple comment' },
    withFile: { pr_id: 1, file: 'src/app.ts', line: 25, original_comment: 'File-specific comment' },
    coderabbit: { 
        pr_id: 1, 
        author: 'coderabbit[bot]', 
        original_comment: 'Consider refactoring this method',
        prompt_for_ai_agents: 'Should this method be refactored for better readability?'
    },
    replied: { pr_id: 1, original_comment: 'Replied comment', replied: true, reply: 'Fixed!' },
    fixed: { pr_id: 1, original_comment: 'Fixed comment', fix_applied: true }
});
```

## Implementation Checklist

### Config Updates
- [ ] Add database configuration to `src/config.ts`
- [ ] Update `Config` type in `src/types/config.ts`
- [ ] Ensure database path uses project root relative path

### Service Implementation
- [ ] Implement DatabaseService class with all required methods
- [ ] Configure Bun SQLite with WAL mode and optimizations
- [ ] Implement prepared statements for all operations
- [ ] Add proper error handling with custom error types
- [ ] Implement schema versioning with PRAGMA user_version
- [ ] Add transaction support for complex operations

### Database Schema
- [ ] Implement exact schema from overview.md
- [ ] Add proper indexes for performance
- [ ] Implement foreign key constraints
- [ ] Add CHECK constraints for agreement field

### Initialization Script
- [ ] Create standalone init script
- [ ] Add npm script for database initialization
- [ ] Include proper logging and error handling
- [ ] Make script idempotent (safe to run multiple times)

### Type Definitions
- [ ] Define all database record types
- [ ] Create insert/update/filter types
- [ ] Export all types from types/database.ts
- [ ] Ensure strict TypeScript compliance

### Testing
- [ ] Write comprehensive unit tests
- [ ] Test all CRUD operations
- [ ] Test constraint validations
- [ ] Test error scenarios
- [ ] Test performance characteristics
- [ ] Ensure 100% test coverage for critical paths

## Key Technical Considerations

1. **Directory Creation**: Ensure the `.coderabbit-mcp` directory is created automatically
2. **Path Resolution**: Use proper path resolution for cross-platform compatibility
3. **Connection Lifecycle**: Implement proper connection pooling/management
4. **Error Recovery**: Handle database corruption and recovery scenarios
5. **Performance Monitoring**: Add logging for slow queries and operations
6. **Type Safety**: Leverage Bun's SQLite type safety features fully
7. **Concurrent Access**: Test WAL mode effectiveness for concurrent operations

## Common Pitfalls and Solutions

### 1. File Path Issues
**Problem**: Database file not found errors
```typescript
// ❌ Wrong - relative paths can be problematic
const db = new Database("./data/state.db");

// ✅ Correct - use absolute paths
import { resolve } from "path";
const dbPath = resolve(process.cwd(), ".coderabbit-mcp/state.db");
const db = new Database(dbPath);
```

### 2. Statement Parameter Binding
**Problem**: SQL injection or parameter mismatch
```typescript
// ❌ Wrong - string concatenation
const query = `SELECT * FROM pr WHERE repo = '${repo}'`;

// ✅ Correct - parameter binding
const stmt = db.prepare("SELECT * FROM pr WHERE repo = ?");
const result = stmt.get(repo);
```

### 3. Boolean Handling in SQLite
**Problem**: SQLite stores booleans as integers
```typescript
// ✅ Correct - SQLite returns 0/1 for booleans, but Bun converts them
const comment = stmt.get(id) as CommentRecord;
// comment.replied will be true/false, not 0/1 (Bun handles this)
```

### 4. Null vs Undefined
**Problem**: Mixing null and undefined in database operations
```typescript
// ✅ Correct - use null for database fields
const commentData: CommentInsert = {
    pr_id: 1,
    file: null,  // Use null, not undefined
    line: null,  // Use null, not undefined
    original_comment: 'Test'
};
```

### 5. Transaction Usage
**Problem**: Not using transactions for related operations
```typescript
// ✅ Correct - use transactions for related operations
const result = db.transaction(() => {
    const pr = createPrStmt.get(repo, number);
    const comment1 = createCommentStmt.get(pr.id, 'Comment 1');
    const comment2 = createCommentStmt.get(pr.id, 'Comment 2');
    return { pr, comments: [comment1, comment2] };
})();
```

## Debug Tips

### 1. Enable SQL Logging
```typescript
// Add to connect() method for debugging
if (config.isDevelopment) {
    this.db.exec("PRAGMA compile_options"); // Shows SQLite compile options
    // Log all SQL statements (remove in production)
    const originalPrepare = this.db.prepare.bind(this.db);
    this.db.prepare = (sql: string) => {
        logger.debug('SQL Query', { sql });
        return originalPrepare(sql);
    };
}
```

### 2. Check Database Schema
```typescript
// Helper method to inspect schema
private debugSchema(): void {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    logger.debug('Database tables', { tables });
    
    for (const table of tables) {
        const schema = this.db.prepare(`PRAGMA table_info(${table.name})`).all();
        logger.debug(`Table ${table.name} schema`, { schema });
    }
}
```

### 3. Test Database State
```typescript
// In tests, inspect database state
it('should create comment successfully', () => {
    const comment = dbService.createComment(commentData);
    
    // Debug: Check what's actually in the database
    const rawResult = dbService.db.prepare("SELECT * FROM comment WHERE id = ?").get(comment.id);
    console.log('Raw database result:', rawResult);
    
    expect(comment.id).toBeGreaterThan(0);
});
```

## Success Criteria

- [ ] All tests pass with `bun test`
- [ ] TypeScript compilation succeeds with `bun run typecheck`  
- [ ] Linting passes with `bun run lint`
- [ ] Database initialization script runs successfully
- [ ] Service integrates properly with existing config system
- [ ] Performance meets requirements (sub-millisecond for simple queries)
- [ ] Proper error handling and logging throughout
- [ ] All CRUD operations work correctly
- [ ] Foreign key constraints are enforced
- [ ] CHECK constraints validate data properly
- [ ] WAL mode enables concurrent access
- [ ] Schema migrations work correctly
- [ ] Memory usage is reasonable (< 50MB for typical workloads)

## Final Checklist for Junior Developers

Before submitting your implementation:

1. **Code Quality**
   - [ ] All imports are properly typed
   - [ ] Error handling covers all failure cases
   - [ ] Logging includes relevant context
   - [ ] No `any` types used anywhere

2. **Database Operations**
   - [ ] All SQL statements use prepared statements
   - [ ] Foreign key constraints are working
   - [ ] CHECK constraints prevent invalid data
   - [ ] Indexes improve query performance

3. **Testing**  
   - [ ] All public methods have tests
   - [ ] Error conditions are tested
   - [ ] Edge cases are covered
   - [ ] Test data is properly cleaned up

4. **Integration**
   - [ ] Config system integration works
   - [ ] Logger integration works  
   - [ ] Error classes are properly imported
   - [ ] Type definitions are complete

5. **Performance**
   - [ ] Simple queries complete in < 1ms
   - [ ] Complex queries complete in < 10ms
   - [ ] Memory usage is stable under load
   - [ ] WAL mode allows concurrent reads

Run these commands to verify everything works:
```bash
bun run typecheck
bun run lint  
bun test tests/unit/services/database.test.ts
bun run db:init
```