export class DatabaseError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'DatabaseError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
