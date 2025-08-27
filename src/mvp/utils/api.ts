import { $ } from 'bun';
import type { Comment, PullRequest } from '../types';

export async function getPullRequestForBranch(repo: string, branch: string): Promise<PullRequest> {
    const json =
        await $`gh pr list --repo ${repo} --head ${branch} --json number,title,headRefName,baseRefName,url`.text();
    const prs: PullRequest[] = JSON.parse(json);

    const [pr] = prs;
    if (!pr) {
        throw new Error(`No PR found for ${repo}:${branch}`);
    }

    return pr;
}

export async function getReviewCommentsForPullRequest(pr: PullRequest): Promise<Comment[]> {
    const match = pr.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Invalid GitHub PR URL: ${pr.url}`);
    const [, owner, repo, prNumberStr] = match;
    if (!prNumberStr) {
        throw new Error(`Could not parse PR number from URL: ${pr.url}`);
    }
    const prNumber = parseInt(prNumberStr, 10);

    const query = `
      query($owner: String!, $repo: String!, $pr: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100) {
              nodes {
                isResolved
                isOutdated
                comments(first: 100) {
                  nodes {
                    databaseId
                    author { login }
                    body
                    createdAt
                    url
                    path
                    position
                    isMinimized
                  }
                }
              }
            }
          }
        }
      }
    `;

    const result = await $`gh api graphql -f query=${query} -f owner=${owner} -f repo=${repo} -F pr=${prNumber}`.json();

    const allComments: Comment[] = [];
    const threads = result.data.repository.pullRequest.reviewThreads.nodes;

    for (const thread of threads) {
        for (const comment of thread.comments.nodes) {
            allComments.push({
                commentId: comment.databaseId,
                body: comment.body,
                author: comment.author,
                createdAt: comment.createdAt,
                url: comment.url,
                path: comment.path,
                position: comment.position,
                isResolved: thread.isResolved,
                isOutdated: thread.isOutdated,
                isMinimized: comment.isMinimized,
            });
        }
    }

    return allComments;
}
