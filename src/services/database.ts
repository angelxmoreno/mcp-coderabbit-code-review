import { Database, type Statement } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config';
import { DatabaseError } from '../errors/database';
import type { CommentFilters, CommentInsert, CommentRecord, CommentUpdate, PrRecord, PrStats } from '../types/database';
import { logger } from '../utils/logger';

export class DatabaseService {
    protected db: Database | null = null;
    protected statements: Record<string, Statement> = {};
    protected readonly databasePath: string;

    constructor(databasePath?: string) {
        this.databasePath = databasePath || config.database.path;
    }

    public async connect(): Promise<void> {
        try {
            this.ensureDatabaseDirectory();

            this.db = new Database(this.databasePath);

            // Configure SQLite with values from config
            const journalMode = this.validateJournalMode(config.database.journalMode);
            const synchronous = this.validateSynchronous(config.database.synchronous);
            const busyTimeout = this.validateBusyTimeout(config.database.busyTimeout);

            this.db.exec(`PRAGMA journal_mode = ${journalMode}`);
            this.db.exec(`PRAGMA synchronous = ${synchronous}`);
            this.db.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
            this.db.exec('PRAGMA cache_size = -64000'); // Keep hardcoded
            this.db.exec('PRAGMA temp_store = MEMORY'); // Keep hardcoded
            this.db.exec('PRAGMA mmap_size = 268435456'); // Keep hardcoded
            this.db.exec('PRAGMA foreign_keys = ON'); // Keep hardcoded

            this.initializeSchema();
            this.runMigrations();
            this.prepareStatements();

            logger.info({ path: this.databasePath }, 'Database connection established');
        } catch (error) {
            // Cleanup partially opened database connection
            if (this.db) {
                try {
                    this.db.close();
                } catch (closeError) {
                    // Ignore errors during cleanup
                    logger.debug({ closeError }, 'Error during database cleanup');
                }
                this.db = null;
                this.statements = {};
            }

            logger.error({ error, path: this.databasePath }, 'Failed to connect to database');
            throw new DatabaseError(`Failed to connect to database`, { cause: error });
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
                logger.error({ error }, 'Error closing database');
                throw new DatabaseError(`Failed to close database`, { cause: error });
            }
        }
    }

    protected ensureDatabaseDirectory(): void {
        const dir = dirname(this.databasePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
            logger.info({ directory: dir }, 'Created database directory');
        }
    }

    protected initializeSchema(): void {
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

    protected runMigrations(): void {
        const currentVersion = this.getCurrentVersion();
        const latestVersion = 1;

        if (currentVersion < latestVersion) {
            logger.info({ from: currentVersion, to: latestVersion }, 'Running database migrations');

            this.setVersion(latestVersion);
            logger.info('Database migrations completed');
        }
    }

    protected getCurrentVersion(): number {
        if (!this.db) throw new DatabaseError('Database not connected');
        const result = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
        return result.user_version;
    }

    protected setVersion(version: number): void {
        if (!this.db) throw new DatabaseError('Database not connected');
        this.db.exec(`PRAGMA user_version = ${version}`);
    }

    protected prepareStatements(): void {
        if (!this.db) throw new DatabaseError('Database not connected');

        try {
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
                SET agreement   = COALESCE(?, agreement),
                    reply       = COALESCE(?, reply),
                    replied     = COALESCE(?, replied),
                    fix_applied = COALESCE(?, fix_applied),
                    reviewed_at = COALESCE(?, reviewed_at),
                    fixed_at    = COALESCE(?, fixed_at)
                WHERE id = ?
            `);

            this.statements.getCommentsByPr = this.db.prepare(`
                SELECT * FROM comment 
                WHERE pr_id = ? 
                AND (? IS NULL OR replied = ?)
                AND (? IS NULL OR fix_applied = ?)
                AND (? IS NULL OR agreement = ?)
                AND (? IS NULL OR author = ?)
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
                    COALESCE(SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END), 0) as replied,
                    COALESCE(SUM(CASE WHEN fix_applied = 1 THEN 1 ELSE 0 END), 0) as fixed,
                    GROUP_CONCAT(CASE WHEN replied = 0 THEN id END) as pending_ids
                FROM comment 
                WHERE pr_id = ?
            `);

            logger.info({ count: Object.keys(this.statements).length }, 'Prepared statements created');
        } catch (error) {
            logger.error({ error }, 'Failed to prepare statements');
            throw new DatabaseError(`Failed to prepare statements`, { cause: error });
        }
    }

    public createPr(repo: string, number: number): PrRecord {
        if (!this.db || !this.statements.createPr) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }

        try {
            const timestamp = new Date().toISOString();
            const result = this.statements.createPr.get(repo, number, timestamp) as PrRecord;

            logger.info({ id: result.id, repo, number }, 'PR created');
            return result;
        } catch (error) {
            if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
                throw new DatabaseError(`PR already exists: ${repo}#${number}`, { cause: error });
            }
            logger.error({ error, repo, number }, 'Failed to create PR');
            throw new DatabaseError(`Failed to create PR`, { cause: error });
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
            logger.error({ error, repo, number }, 'Failed to get PR');
            throw new DatabaseError(`Failed to get PR`, { cause: error });
        }
    }

    public updatePrLastSynced(id: number, timestamp: string): void {
        if (!this.db || !this.statements.updatePrLastSynced) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        this.statements.updatePrLastSynced.run(timestamp, id);
    }

    public listPrs(repo?: string): PrRecord[] {
        if (!this.db || !this.statements.listPrs) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        return this.statements.listPrs.all(repo || null, repo || null) as PrRecord[];
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

            logger.info({ id: result.id, pr_id: commentData.pr_id }, 'Comment created');
            return this.mapComment(result);
        } catch (error) {
            logger.error({ error, commentData }, 'Failed to create comment');
            throw new DatabaseError(`Failed to create comment`, { cause: error });
        }
    }

    public getComment(id: number): CommentRecord | null {
        if (!this.db || !this.statements.getComment) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        const result = this.statements.getComment.get(id) as CommentRecord | null;
        return result ? this.mapComment(result) : null;
    }

    public updateComment(id: number, updates: Partial<CommentUpdate>): void {
        if (!this.db || !this.statements.updateComment) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        this.statements.updateComment.run(
            updates.agreement ?? null,
            updates.reply ?? null,
            updates.replied === undefined ? null : updates.replied ? 1 : 0,
            updates.fix_applied === undefined ? null : updates.fix_applied ? 1 : 0,
            updates.reviewed_at ?? null,
            updates.fixed_at ?? null,
            id
        );
    }

    public getCommentsByPr(prId: number, filters: CommentFilters = {}): CommentRecord[] {
        if (!this.db || !this.statements.getCommentsByPr) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        const replied = filters.replied === undefined ? null : filters.replied ? 1 : 0;
        const fix_applied = filters.fix_applied === undefined ? null : filters.fix_applied ? 1 : 0;
        const agreement = filters.agreement === undefined ? null : filters.agreement;
        const author = filters.author === undefined ? null : filters.author;

        const results = this.statements.getCommentsByPr.all(
            prId,
            replied,
            replied,
            fix_applied,
            fix_applied,
            agreement,
            agreement,
            author,
            author
        ) as CommentRecord[];
        return results.map(this.mapComment);
    }

    public markCommentReplied(id: number, reply: string): void {
        if (!this.db || !this.statements.markCommentReplied) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        this.statements.markCommentReplied.run(reply, id);
    }

    public markCommentFixed(id: number): void {
        if (!this.db || !this.statements.markCommentFixed) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        this.statements.markCommentFixed.run(id);
    }

    public getPrStats(prId: number): PrStats {
        if (!this.db || !this.statements.getPrStats) {
            throw new DatabaseError('Database not connected or statements not prepared');
        }
        return this.statements.getPrStats.get(prId) as PrStats;
    }

    public transaction<T>(fn: () => T): T {
        if (!this.db) {
            throw new DatabaseError('Database not connected');
        }
        return this.db.transaction(fn)();
    }

    protected mapComment(comment: CommentRecord): CommentRecord {
        return {
            ...comment,
            replied: Boolean(comment.replied),
            fix_applied: Boolean(comment.fix_applied),
        };
    }

    private validateJournalMode(journalMode: string): string {
        const validModes = ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'];
        const upperMode = journalMode.toUpperCase();

        if (!validModes.includes(upperMode)) {
            logger.warn({ journalMode, valid: validModes }, 'Invalid journal_mode, using WAL');
            return 'WAL';
        }

        return upperMode;
    }

    private validateSynchronous(synchronous: string): string {
        const validModes = ['OFF', 'NORMAL', 'FULL', 'EXTRA'];
        const upperMode = synchronous.toUpperCase();

        if (!validModes.includes(upperMode)) {
            logger.warn({ synchronous, valid: validModes }, 'Invalid synchronous mode, using NORMAL');
            return 'NORMAL';
        }

        return upperMode;
    }

    private validateBusyTimeout(busyTimeout: number): number {
        if (!Number.isInteger(busyTimeout) || busyTimeout < 0) {
            logger.warn({ busyTimeout }, 'Invalid busy_timeout, using 5000ms');
            return 5000;
        }

        return busyTimeout;
    }
}
