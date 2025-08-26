export class GitHubError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'GitHubError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
