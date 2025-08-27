import { createBaseLogger } from '../utils/logger.ts';
import { MvpProcessor } from './MvpProcessor.ts';
import { writeToJsonFile } from './utils/io';

const logger = createBaseLogger({
    level: 'debug',
});
const service = new MvpProcessor({
    logger,
});

const main = async () => {
    const pr = await service.findPullRequest();
    const comments = await service.fetchReviewComments(pr);
    const parsed = service.parseBotComments(comments);
    const actionableComments = service.filterCodeRabbitCommentsWithAiPrompt(parsed);
    const safeTitle = pr.title
        .toLowerCase()
        .replace(/\s+/g, '-') // replace all whitespace with dash
        .replace(/[^a-z0-9-_]/g, '-'); // remove everything except letters, numbers, dash, underscore

    await writeToJsonFile(actionableComments, `${safeTitle}-actionable`);
    logger.info({ actionableComments, parsed }, 'output');
};

main().catch(console.error);
