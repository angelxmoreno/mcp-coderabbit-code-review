import { GitHubError } from './GitHubError';

export class AuthenticationError extends GitHubError {
    constructor(message: string = 'GitHub authentication failed', options?: ErrorOptions) {
        super(message, options);
        this.name = 'AuthenticationError';
    }
}
