/**
 * CodeRabbit comment parsing utilities
 * Extracts structured data from CodeRabbit bot comments
 */

import type { BaseComment, CodeRabbitComment, Comment } from '../types/bots';
import { logger } from '../utils/logger';

/**
 * Parse a comment and return the appropriate type (CodeRabbit or base)
 */
export function parseComment(comment: BaseComment): Comment {
    if (comment.author.login === 'coderabbitai' || comment.author.login === 'coderabbitai[bot]') {
        return parseCodeRabbitComment(comment);
    }
    return comment;
}

/**
 * Parse a CodeRabbit comment body into CodeRabbitComment
 */
export function parseCodeRabbitComment(comment: BaseComment): CodeRabbitComment {
    logger.debug({ commentId: comment.commentId }, 'Parsing CodeRabbit comment');

    // Extract type (⚠️ Potential issue, 💡 Verification agent, etc.)
    const typeMatch = comment.body.match(/^_((?:⚠️|💡|❗|💬|🛠️).+?)_/m);

    // Extract bold summary (**text**)
    const summaryMatch = comment.body.match(/\*\*(.+?)\*\*/);

    // Extract diff blocks
    const diffMatch = comment.body.match(/```diff\n([\s\S]+?)```/);

    // Extract suggested code
    const suggestedCodeMatch = comment.body.match(/```suggestion\n([\s\S]+?)```/);

    // Extract heading
    const headingMatch = comment.body.match(/^###\s+(.+)$/m);

    // Extract internal tracking ID
    const internalIdMatch = comment.body.match(/<!-- fingerprinting:([a-z:]+) -->/);

    // Extract tools used
    const toolsMatches = Array.from(comment.body.matchAll(/<summary>🪛 ([^<]+)<\/summary>/g));

    // Extract AI prompt for agents
    const aiPromptMatch = comment.body.match(/<summary>🤖 Prompt for AI Agents<\/summary>[\s\S]*?```\n([\s\S]+?)```/);

    // Extract committable suggestion
    const committableMatch = comment.body.match(/📝 Committable suggestion[\s\S]*?```[\s\S]*?\n([\s\S]+?)```/);
    const committableSuggestion = committableMatch?.[1]?.trim();

    const result: CodeRabbitComment = {
        ...comment,
        bot: 'coderabbitai[bot]',
        type: typeMatch?.[1]?.trim().replace(/^(?:⚠️|💡|❗|💬|🛠️)\s*/, ''),
        heading: headingMatch?.[1]?.trim(),
        summary: summaryMatch?.[1]?.trim(),
        diff: diffMatch?.[1]?.trim(),
        suggestedCode: suggestedCodeMatch?.[1]?.trim(),
        committableSuggestion,
        aiPrompt: aiPromptMatch?.[1]?.trim(),
        tools: toolsMatches
            .map((m) => m[1])
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim()),
        internalId: internalIdMatch?.[1],
    };

    logger.debug(
        {
            commentId: comment.commentId,
            hasAiPrompt: !!result.aiPrompt,
            hasType: !!result.type,
            toolsCount: result.tools.length,
        },
        'CodeRabbit comment parsed'
    );

    return result;
}

/**
 * Parse multiple comments in batch
 */
export function parseComments(comments: BaseComment[]): Comment[] {
    logger.info({ count: comments.length }, 'Parsing comments');

    return comments.map((comment) => parseComment(comment));
}

/**
 * Filter comments to only CodeRabbit comments with actionable content
 */
export function filterActionableComments(comments: Comment[]): CodeRabbitComment[] {
    return comments.filter((comment): comment is CodeRabbitComment => {
        if ('bot' in comment && comment.bot === 'coderabbitai[bot]') {
            // CodeRabbit comments are actionable if they have AI prompts or suggested code
            return !!(comment.aiPrompt || comment.suggestedCode || comment.committableSuggestion);
        }
        return false;
    });
}
