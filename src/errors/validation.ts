export class ValidationError extends Error {
    constructor(field: string, value: unknown, requirement: string) {
        super(`Invalid ${field}: ${value}. ${requirement}`);
        this.name = 'ValidationError';
    }
}
