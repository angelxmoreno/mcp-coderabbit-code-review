import type { CodeRabbitComment, Comment, KorbitComment } from '../types';

// Parse a CodeRabbit comment body into CodeRabbitComment
export function parseCommentCodeRabbit(comment: Comment): CodeRabbitComment {
    const typeMatch = comment.body.match(/^_((?:⚠️|💡|❗|💬|🛠️).+?)_/m);
    const summaryMatch = comment.body.match(/\*\*(.+?)\*\*/);
    const diffMatch = comment.body.match(/```diff\n([\s\S]+?)```/);
    const suggestedCodeMatch = comment.body.match(/```suggestion\n([\s\S]+?)```/);
    const headingMatch = comment.body.match(/^###\s+(.+)$/m);
    const internalIdMatch = comment.body.match(/<!-- fingerprinting:([a-z:]+) -->/);
    const toolsMatches = Array.from(comment.body.matchAll(/<summary>🪛 ([^<]+)<\/summary>/g));
    const aiPromptMatch = comment.body.match(/<summary>🤖 Prompt for AI Agents<\/summary>[\s\S]*?```\n([\s\S]+?)```/);

    // Optional: extract committable suggestion
    const committableMatch = comment.body.match(/📝 Committable suggestion\s*```[\s\S]+?```/);
    const committableSuggestion = committableMatch?.[0]
        .replace(/📝 Committable suggestion\s*```[\s\S]*?\n|```$/g, '')
        .trim();

    return {
        ...comment,
        bot: 'coderabbitai[bot]',
        type: typeMatch?.[1]?.trim().replace(/^(?:⚠️|💡|❗|💬|🛠️)\s*/, ''),
        heading: headingMatch?.[1]?.trim(),
        summary: summaryMatch?.[1]?.trim(),
        explanation: undefined, // could implement later by extracting body after summary
        diff: diffMatch?.[1]?.trim(),
        suggestedCode: suggestedCodeMatch?.[1]?.trim(),
        committableSuggestion,
        aiPrompt: aiPromptMatch?.[1]?.trim(), // optional, could parse if present
        tools: toolsMatches
            .map((m) => m[1])
            .filter((t): t is string => typeof t === 'string') // keep only defined strings
            .map((t) => t.trim()), // now safe, t cannot be undefined
        internalId: internalIdMatch?.[1],
    };
}

// Parse a Korbit comment body into KorbitComment
export function parseCommentKorbit(comment: Comment): KorbitComment {
    const headingMatch = comment.body.match(/^### (.+)$/m);
    const suggestedCodeMatch = comment.body.match(/```typescript\n([\s\S]+?)```/);
    const feedbackMatches = Array.from(comment.body.matchAll(/[[]![\s\S]*?\]\([\s\S]*?\)\]\([\s\S]*?\)/g));
    const internalIdMatch = comment.body.match(/<!--- korbi internal id:([a-z0-9-]+) -->/);

    return {
        ...comment,
        bot: 'korbit-ai[bot]',
        heading: headingMatch?.[1],
        suggestedCode: suggestedCodeMatch?.[1],
        feedbackButtons: feedbackMatches.map((m) => m[0]),
        internalId: internalIdMatch?.[1],
    };
}
