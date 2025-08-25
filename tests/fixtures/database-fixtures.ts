import type { CommentInsert, PrInsert } from '../../src/types/database.ts';

export const createMockPr = (overrides: Partial<PrInsert> = {}): PrInsert => ({
    repo: 'test/repo',
    number: 123,
    last_synced: new Date().toISOString(),
    ...overrides,
});

export const createMockComment = (prId: number, overrides: Partial<CommentInsert> = {}): CommentInsert => ({
    pr_id: prId,
    file: 'src/test.ts',
    line: 10,
    author: 'coderabbit',
    original_comment: 'Consider using const instead of let',
    prompt_for_ai_agents: 'Should we use const instead of let here?',
    ...overrides,
});

export const createMockCommentData = () => ({
    simple: { pr_id: 1, original_comment: 'Simple comment' },
    withFile: { pr_id: 1, file: 'src/app.ts', line: 25, original_comment: 'File-specific comment' },
    coderabbit: {
        pr_id: 1,
        author: 'coderabbit[bot]',
        original_comment: 'Consider refactoring this method',
        prompt_for_ai_agents: 'Should this method be refactored for better readability?',
    },
    replied: { pr_id: 1, original_comment: 'Replied comment', replied: true, reply: 'Fixed!' },
    fixed: { pr_id: 1, original_comment: 'Fixed comment', fix_applied: true },
});
