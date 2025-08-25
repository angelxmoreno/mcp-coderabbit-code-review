export class NotFoundError extends Error {
    constructor(resource: string, identifier: string | number) {
        super(`${resource} not found: ${identifier}`);
        this.name = 'NotFoundError';
    }
}
