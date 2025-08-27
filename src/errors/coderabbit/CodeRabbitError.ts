export class CodeRabbitError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CodeRabbitError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
