import type { Logger } from 'pino';
import type { CodeRabbitComment, Comment, KorbitComment, PullRequest, RepoBranch } from './types';
import { getPullRequestForBranch, getReviewCommentsForPullRequest } from './utils/api';
import { getCurrentRepoAndBranch } from './utils/logic';
import { parseCommentCodeRabbit, parseCommentKorbit } from './utils/parsing';

type MvpProcessorOptions = {
    logger: Logger;
};

export class MvpProcessor {
    protected logger: Logger;

    constructor({ logger }: MvpProcessorOptions) {
        this.logger = logger;
    }

    async main(): Promise<void> {
        // identify the repo/branch we are on
        // find the pr that matches the repo/branch
        // if not found throw
        // with the repo and branch on hand fetch all comments and store
        // extract comments for pre-processing (only coderabbit comments for now)
        // identify duplicate comments and group together
        // define which comments we agree and a comment reply
        // work on comments we agree
    }

    async findPullRequest(): Promise<PullRequest> {
        const { repo, branch }: RepoBranch = await getCurrentRepoAndBranch();
        this.logger.info({ repo, branch }, 'Looking up PR with gh...');

        const pr = await getPullRequestForBranch(repo, branch);
        this.logger.info({ prNumber: pr.number, prUrl: pr.url }, 'Found PR');

        return pr;
    }

    async fetchReviewComments(pr: PullRequest): Promise<Comment[]> {
        const comments = await getReviewCommentsForPullRequest(pr);
        this.logger.info({ count: comments.length }, 'Fetched review comments');
        return comments;
    }

    parseBotComments(comments: Comment[]): Array<Comment | CodeRabbitComment | KorbitComment> {
        return comments.map((comment) => {
            switch (comment.author.login) {
                case 'coderabbitai':
                    return parseCommentCodeRabbit(comment);
                case 'korbit-ai':
                    return parseCommentKorbit(comment);
                default:
                    return comment;
            }
        });
    }

    filterCodeRabbitCommentsWithAiPrompt(
        comments: Array<Comment | CodeRabbitComment | KorbitComment>
    ): CodeRabbitComment[] {
        return comments.filter(
            (comment): comment is CodeRabbitComment =>
                'bot' in comment && comment.bot === 'coderabbitai[bot]' && !!comment.aiPrompt
        );
    }
}
