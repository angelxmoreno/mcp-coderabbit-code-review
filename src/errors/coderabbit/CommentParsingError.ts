import { CodeRabbitError } from './CodeRabbitError.ts';

export class CommentParsingError extends CodeRabbitError {
    constructor(message: string = 'Failed to parse CodeRabbit comment', options?: ErrorOptions) {
        super(message, options);
        this.name = 'CommentParsingError';
    }
}
