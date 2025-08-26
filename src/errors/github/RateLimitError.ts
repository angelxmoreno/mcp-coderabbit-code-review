import { GitHubError } from './GitHubError';

export class RateLimitError extends GitHubError {
    constructor(
        message: string = 'GitHub API rate limit exceeded',
        /** Unix timestamp (in seconds) when the rate limit will reset */
        public resetTime?: number,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = 'RateLimitError';
    }
}
