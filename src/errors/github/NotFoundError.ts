import { GitHubError } from './GitHubError';

export class NotFoundError extends GitHubError {
    constructor(resource: string, options?: ErrorOptions) {
        super(`GitHub resource not found: ${resource}`, options);
        this.name = 'NotFoundError';
    }
}
