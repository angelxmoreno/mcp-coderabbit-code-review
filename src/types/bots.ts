/**
 * Enhanced CodeRabbit type system for code review automation
 * Based on MVP demo architecture - focused on CodeRabbit only
 */

/**
 * Base comment interface that all comments extend
 */
export interface BaseComment {
    commentId: number;
    body: string;
    author: { login: string };
    createdAt: string;
    url: string;
    path?: string; // file path for review comments
    position?: number; // line number for review comments
    isResolved?: boolean;
    isOutdated?: boolean;
    isMinimized?: boolean;
}

/**
 * CodeRabbit-specific comment with parsed structured data
 */
export interface CodeRabbitComment extends BaseComment {
    bot: 'coderabbitai[bot]';
    type?: string; // e.g., "Potential issue", "Verification agent"
    heading?: string;
    summary?: string;
    explanation?: string;
    diff?: string;
    suggestedCode?: string;
    committableSuggestion?: string;
    aiPrompt?: string;
    tools: string[];
    internalId?: string;
}

/**
 * Union type for all possible comment types
 */
export type Comment = BaseComment | CodeRabbitComment;

/**
 * Type guards for comment type checking
 */
export function isCodeRabbitComment(comment: BaseComment): comment is CodeRabbitComment {
    return comment.author.login === 'coderabbitai' || comment.author.login === 'coderabbitai[bot]';
}

export function isBotComment(comment: BaseComment): comment is CodeRabbitComment {
    return isCodeRabbitComment(comment);
}

/**
 * Enhanced analysis result for CodeRabbit comments
 */
export interface CodeRabbitAnalysis {
    commentId: number;
    botType: 'coderabbitai';
    type?: string;
    summary?: string;
    aiPrompt?: string;
    diff?: string;
    suggestedCode?: string;
    committableSuggestion?: string;
    tools: string[];
    internalId?: string;
    extractedAt: string;
    isActionable: boolean; // has AI prompt or suggested code
}
