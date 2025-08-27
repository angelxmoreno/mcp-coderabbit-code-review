import { $ } from 'bun';
import type { RepoBranch } from '../types';

export async function getCurrentRepoAndBranch(): Promise<RepoBranch> {
    const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
    const remoteUrl = (await $`git config --get remote.origin.url`.text()).trim();

    const match = remoteUrl.match(/[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (!match || !match[1]) {
        throw new Error(`Could not parse remote URL: ${remoteUrl}`);
    }

    const repo = match[1];
    return { repo, branch };
}
