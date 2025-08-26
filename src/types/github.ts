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
