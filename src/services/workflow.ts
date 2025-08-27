import { $ } from 'bun';
import type { Comment } from '../types/bots';
import { filterActionableComments, parseComments } from '../utils/bot-parser';
import { logger } from '../utils/logger';
import { type GitHubPRInfo, GitHubService } from './github';

export interface WorkflowConfig {
    /** Repository in owner/repo format */
    repo?: string;
    /** Branch name to process */
    branch?: string;
    /** PR number to process */
    prNumber?: number;
    /** Only process actionable comments */
    actionableOnly?: boolean;
}

export interface WorkflowResult {
    repo: string;
    prNumber: number;
    totalComments: number;
    botComments: number;
    actionableComments: number;
    comments: Comment[];
}

/**
 * Workflow engine for automated bot comment processing
 * Provides auto-detection of repos, branches, and PR processing
 */
export class WorkflowEngine {
    protected githubService: GitHubService;

    constructor(githubToken?: string) {
        this.githubService = new GitHubService(githubToken);
    }
    /**
     * Auto-detects current repository information
     */
    public async detectCurrentRepo(): Promise<string> {
        try {
            const remoteUrl = await $`git remote get-url origin`.text();
            const match = remoteUrl.trim().match(/github\.com[:/]([^/]+\/[^/]+)(?:\.git)?$/);

            if (!match || !match[1]) {
                throw new Error(`Could not parse GitHub repo from remote URL: ${remoteUrl}`);
            }

            return match[1];
        } catch (error) {
            logger.error({ error }, 'Failed to detect current repository');
            throw new Error(
                'Failed to detect current repository. Make sure you are in a git repository with a GitHub remote.'
            );
        }
    }

    /**
     * Auto-detects current branch name
     */
    public async detectCurrentBranch(): Promise<string> {
        try {
            const branch = await $`git branch --show-current`.text();
            return branch.trim();
        } catch (error) {
            logger.error({ error }, 'Failed to detect current branch');
            throw new Error('Failed to detect current branch. Make sure you are in a git repository.');
        }
    }

    /**
     * Processes a workflow with automatic detection and comment parsing
     */
    public async processWorkflow(config: WorkflowConfig = {}): Promise<WorkflowResult> {
        logger.info({ config }, 'Starting workflow processing');

        try {
            // Auto-detect repository if not provided
            const repo = config.repo || (await this.detectCurrentRepo());
            logger.info({ repo }, 'Using repository');

            let prInfo: GitHubPRInfo;

            if (config.prNumber) {
                // Use provided PR number
                prInfo = {
                    number: config.prNumber,
                    title: '',
                    headRefName: '',
                    baseRefName: '',
                    url: `https://github.com/${repo}/pull/${config.prNumber}`,
                };
            } else {
                // Auto-detect branch and find PR
                const branch = config.branch || (await this.detectCurrentBranch());
                logger.info({ branch }, 'Using branch');

                prInfo = await this.githubService.getPullRequestForBranch(repo, branch);
            }

            logger.info({ prNumber: prInfo.number, title: prInfo.title }, 'Processing pull request');

            // Fetch comments using GraphQL
            const [owner, repoName] = repo.split('/');
            if (!owner || !repoName) {
                throw new Error(`Invalid repository format: ${repo}`);
            }

            const baseComments = await this.githubService.getCommentsForPR(owner, repoName, prInfo.number);
            logger.info({ count: baseComments.length }, 'Fetched comments from GitHub');

            // Parse comments to identify bot types and extract metadata
            const parsedComments = parseComments(baseComments);
            const botComments = parsedComments.filter((comment) => 'bot' in comment);

            // Filter actionable comments if requested
            const finalComments = config.actionableOnly ? filterActionableComments(parsedComments) : parsedComments;

            const result: WorkflowResult = {
                repo,
                prNumber: prInfo.number,
                totalComments: baseComments.length,
                botComments: botComments.length,
                actionableComments: filterActionableComments(parsedComments).length,
                comments: finalComments,
            };

            logger.info(
                {
                    repo: result.repo,
                    prNumber: result.prNumber,
                    totalComments: result.totalComments,
                    botComments: result.botComments,
                    actionableComments: result.actionableComments,
                },
                'Workflow processing completed'
            );

            return result;
        } catch (error) {
            logger.error({ error, config }, 'Workflow processing failed');
            throw error;
        }
    }

    /**
     * Processes current repository and branch automatically
     */
    public async processCurrentWorkflow(): Promise<WorkflowResult> {
        return await this.processWorkflow();
    }

    /**
     * Processes a specific repository and PR
     */
    public async processRepositoryPR(repo: string, prNumber: number): Promise<WorkflowResult> {
        return await this.processWorkflow({ repo, prNumber });
    }

    /**
     * Processes a specific repository and branch
     */
    public async processRepositoryBranch(repo: string, branch: string): Promise<WorkflowResult> {
        return await this.processWorkflow({ repo, branch });
    }
}
