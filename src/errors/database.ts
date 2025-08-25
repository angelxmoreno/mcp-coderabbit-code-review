export class DatabaseError extends Error {
    constructor(
        message: string,
        public override cause?: unknown
    ) {
        super(message);
        this.name = 'DatabaseError';
    }
}
