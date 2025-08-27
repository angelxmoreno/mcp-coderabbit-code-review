import { beforeEach, describe, expect, it } from 'bun:test';
import type { BaseComment } from '../../../src/types/bots';
import {
    filterActionableComments,
    parseCodeRabbitComment,
    parseComment,
    parseComments,
} from '../../../src/utils/bot-parser';

describe('Bot Parser', () => {
    let mockBaseComment: BaseComment;
    let mockCodeRabbitComment: BaseComment;

    beforeEach(() => {
        mockBaseComment = {
            commentId: 123,
            body: 'This is a regular comment',
            author: { login: 'user123' },
            createdAt: '2025-08-27T12:00:00Z',
            url: 'https://github.com/owner/repo/pull/1#issuecomment-123',
            path: 'src/test.ts',
            position: 10,
            isResolved: false,
            isOutdated: false,
            isMinimized: false,
        };

        mockCodeRabbitComment = {
            commentId: 456,
            body: `_⚠️ Potential issue_

**There seems to be an issue with this code.**

<summary>🤖 Prompt for AI Agents</summary>

\`\`\`
How can we fix this issue?
\`\`\`

<summary>🪛 TypeScript ESLint</summary>

Some tool output here.

\`\`\`suggestion
const fixedCode = 'better implementation';
\`\`\`

<!-- fingerprinting:type:suggestion -->`,
            author: { login: 'coderabbitai[bot]' },
            createdAt: '2025-08-27T12:00:00Z',
            url: 'https://github.com/owner/repo/pull/1#issuecomment-456',
            path: 'src/test.ts',
            position: 15,
            isResolved: false,
            isOutdated: false,
            isMinimized: false,
        };
    });

    describe('parseComment', () => {
        it('should return BaseComment for non-CodeRabbit comments', () => {
            const result = parseComment(mockBaseComment);
            expect(result).toEqual(mockBaseComment);
        });

        it('should parse CodeRabbit comments', () => {
            const result = parseComment(mockCodeRabbitComment);

            expect('bot' in result).toBe(true);
            if ('bot' in result) {
                expect(result.bot).toBe('coderabbitai[bot]');
                expect(result.aiPrompt).toBe('How can we fix this issue?');
                expect(result.suggestedCode).toBe("const fixedCode = 'better implementation';");
                expect(result.tools).toContain('TypeScript ESLint');
                expect(result.internalId).toBe('type:suggestion');
            }
        });
    });

    describe('parseCodeRabbitComment', () => {
        it('should extract type from comment', () => {
            const result = parseCodeRabbitComment(mockCodeRabbitComment);
            expect(result.type).toBe('Potential issue');
        });

        it('should extract AI prompt', () => {
            const result = parseCodeRabbitComment(mockCodeRabbitComment);
            expect(result.aiPrompt).toBe('How can we fix this issue?');
        });

        it('should extract suggested code', () => {
            const result = parseCodeRabbitComment(mockCodeRabbitComment);
            expect(result.suggestedCode).toBe("const fixedCode = 'better implementation';");
        });

        it('should extract tools', () => {
            const result = parseCodeRabbitComment(mockCodeRabbitComment);
            expect(result.tools).toEqual(['TypeScript ESLint']);
        });

        it('should extract internal ID', () => {
            const result = parseCodeRabbitComment(mockCodeRabbitComment);
            expect(result.internalId).toBe('type:suggestion');
        });

        it('should handle comments without optional fields', () => {
            const simpleComment = {
                ...mockCodeRabbitComment,
                body: 'Simple CodeRabbit comment without extras',
            };

            const result = parseCodeRabbitComment(simpleComment);
            expect(result.bot).toBe('coderabbitai[bot]');
            expect(result.type).toBeUndefined();
            expect(result.aiPrompt).toBeUndefined();
            expect(result.tools).toEqual([]);
        });
    });

    describe('parseComments', () => {
        it('should parse multiple comments', () => {
            const comments = [mockBaseComment, mockCodeRabbitComment];
            const results = parseComments(comments);

            expect(results).toHaveLength(2);
            expect(results[0]).toEqual(mockBaseComment);
            if (results[1] && 'bot' in results[1]) {
                expect(results[1].bot).toBe('coderabbitai[bot]');
            }
        });

        it('should handle empty array', () => {
            const results = parseComments([]);
            expect(results).toEqual([]);
        });
    });

    describe('filterActionableComments', () => {
        it('should filter comments with AI prompts', () => {
            const comments = [mockBaseComment, mockCodeRabbitComment];
            const parsedComments = parseComments(comments);
            const actionableComments = filterActionableComments(parsedComments);

            expect(actionableComments).toHaveLength(1);
            expect(actionableComments[0]?.bot).toBe('coderabbitai[bot]');
        });

        it('should filter comments with suggested code', () => {
            const commentWithSuggestion = {
                ...mockCodeRabbitComment,
                body: `
                \`\`\`suggestion
                const betterCode = true;
                \`\`\`
                `,
            };

            const comments = [mockBaseComment, commentWithSuggestion];
            const parsedComments = parseComments(comments);
            const actionableComments = filterActionableComments(parsedComments);

            expect(actionableComments).toHaveLength(1);
        });

        it('should exclude CodeRabbit comments without actionable content', () => {
            const nonActionableComment = {
                ...mockCodeRabbitComment,
                body: 'Just a simple comment without prompts or suggestions',
            };

            const comments = [mockBaseComment, nonActionableComment];
            const parsedComments = parseComments(comments);
            const actionableComments = filterActionableComments(parsedComments);

            expect(actionableComments).toHaveLength(0);
        });

        it('should handle empty array', () => {
            const actionableComments = filterActionableComments([]);
            expect(actionableComments).toEqual([]);
        });
    });

    describe('Complex CodeRabbit comment parsing', () => {
        it('should parse a complex CodeRabbit comment with all fields', () => {
            const complexComment: BaseComment = {
                commentId: 789,
                body: `_⚠️ Potential issue_

**Memory leak detected in event listeners**

This code may cause memory leaks because event listeners are not properly removed.

\`\`\`diff
- window.addEventListener('resize', handler);
+ window.addEventListener('resize', handler);
+ // Add cleanup in componentWillUnmount
+ window.removeEventListener('resize', handler);
\`\`\`

<summary>🤖 Prompt for AI Agents</summary>

\`\`\`
Analyze this event listener pattern and suggest proper cleanup mechanisms to prevent memory leaks in React components.
\`\`\`

<summary>🪛 ESLint Plugin React Hooks</summary>

Effect cleanup function should remove event listeners.

<summary>🪛 TypeScript</summary>

Type 'Handler' is not assignable to type 'EventListener'.

\`\`\`suggestion
useEffect(() => {
  const handler = (e: Event) => { /* logic */ };
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
\`\`\`

📝 Committable suggestion

\`\`\`typescript
useEffect(() => {
  const handler = (e: Event) => { /* logic */ };
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
}, []);
\`\`\`

<!-- fingerprinting:memory:cleanup:react -->`,
                author: { login: 'coderabbitai[bot]' },
                createdAt: '2025-08-27T12:00:00Z',
                url: 'https://github.com/owner/repo/pull/1#issuecomment-789',
                path: 'src/component.tsx',
                position: 25,
                isResolved: false,
                isOutdated: false,
                isMinimized: false,
            };

            const result = parseCodeRabbitComment(complexComment);

            expect(result.bot).toBe('coderabbitai[bot]');
            expect(result.type).toBe('Potential issue');
            expect(result.summary).toBe('Memory leak detected in event listeners');
            expect(result.diff).toContain('window.addEventListener');
            expect(result.aiPrompt).toContain('Analyze this event listener pattern');
            expect(result.suggestedCode).toContain('useEffect');
            expect(result.committableSuggestion).toContain('useEffect');
            expect(result.tools).toEqual(['ESLint Plugin React Hooks', 'TypeScript']);
            expect(result.internalId).toBe('memory:cleanup:react');
        });
    });
});
