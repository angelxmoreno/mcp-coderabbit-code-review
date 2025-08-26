/// <reference lib="es2022.error" />
import { GitHubError } from './GitHubError'; // Import GitHubError

export class RateLimitError extends GitHubError {
    constructor(
        message: string = 'GitHub API rate limit exceeded',
        public resetTime?: number,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = 'RateLimitError';
    }
}
