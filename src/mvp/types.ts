/**
 * Represents a GitHub pull request as returned by
 * `gh pr list --json number,title,headRefName,baseRefName,url`
 */
export type PullRequest = {
    number: number;
    title: string;
    headRefName: string;
    baseRefName: string;
    url: string;
};

/**
 * Represents the repo + branch of the current working tree
 */
export type RepoBranch = {
    repo: string;
    branch: string;
};

export type Comment = {
    commentId: number;
    body: string;
    author: { login: string };
    createdAt: string; // unified timestamp
    url: string;
    path?: string; // file path for review comments
    position?: number; // line number for review comments
    isResolved?: boolean;
    isOutdated?: boolean;
    isMinimized?: boolean;
};

export interface CodeRabbitComment extends Comment {
    bot: 'coderabbitai[bot]';
    heading: string | undefined;
    suggestedCode: string | undefined;
    type?: string; // e.g., "⚠️ Potential issue" or "💡 Verification agent"
    summary?: string; // short description of the issue
    explanation?: string; // longer explanation
    diff?: string; // the diff block
    committableSuggestion?: string; // code inside 📝 Committable suggestion
    aiPrompt?: string; // prompt for AI agents
    tools: string[];
    internalId?: string;
}

export type KorbitComment = Comment & {
    bot: 'korbit-ai[bot]';
    heading?: string;
    suggestedCode?: string;
    feedbackButtons?: string[];
    internalId?: string;
};
