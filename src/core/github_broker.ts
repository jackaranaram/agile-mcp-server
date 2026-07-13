import axios, { AxiosError, AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import jwt from 'jsonwebtoken';
import { AgilePlan, UserStory, TechnicalTask, AuthConfig, ExistingEpicInfo, GitHubMilestone, GitHubIssue, InitHarnessResult } from './types';

export interface ApplyPlanResult {
  success: boolean;
  message: string;
  milestoneUrl?: string;
  milestoneNumber?: number;
  createdStories?: Array<{ id: string; number: number; url: string; nodeId?: string }>;
  createdTasks?: Array<{ id: string; number: number; url: string; nodeId?: string }>;
  reusedStories?: Array<{ id: string; number: number; url: string; nodeId?: string }>;
  reusedTasks?: Array<{ id: string; number: number; url: string; nodeId?: string }>;
  report?: string;
  error?: string;
}

export class GitHubBroker {
  private readonly client: AxiosInstance;
  private readonly owner: string;
  private readonly repo: string;
  private readonly authMode: AuthConfig;
  private currentToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(auth: AuthConfig, repository: string, baseUrl: string = 'https://api.github.com') {
    const parts = repository.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository format: "${repository}". Expected "owner/repo".`);
    }
    this.owner = parts[0];
    this.repo = parts[1];
    this.authMode = auth;

    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    this.setupInterceptor();
    this.setupRateLimiting();
  }

  private setupInterceptor(): void {
    this.client.interceptors.request.use(async (config) => {
      const token = await this.resolveToken();
      config.headers.Authorization = this.authMode.type === 'pat' ? `token ${token}` : `Bearer ${token}`;
      return config;
    });
  }

  private setupRateLimiting(): void {
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        return status === 429 || status === 500 || status === 502 || status === 503;
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        const remaining = response.headers?.['x-ratelimit-remaining'];
        if (remaining !== undefined && parseInt(remaining) < 10) {
          const resetTime = parseInt(response.headers['x-ratelimit-reset'] || '0');
          const waitMs = Math.max(0, resetTime * 1000 - Date.now() + 1000);
          if (waitMs > 0) {
            return new Promise(resolve => setTimeout(() => resolve(response), waitMs));
          }
        }
        return response;
      },
      (error) => Promise.reject(error)
    );
  }

  private async resolveToken(): Promise<string> {
    if (this.authMode.type === 'pat') {
      return this.authMode.token;
    }

    if (this.currentToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt.getTime() - 60000) {
      return this.currentToken;
    }

    const appJwt = this.generateAppJwt(this.authMode.appId, this.authMode.privateKey);
    this.currentToken = await this.fetchInstallationToken(appJwt, this.authMode.installationId);
    this.tokenExpiresAt = new Date(Date.now() + 3600000);
    return this.currentToken;
  }

  private generateAppJwt(appId: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    };
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  private async fetchInstallationToken(jwtToken: string, installationId: string): Promise<string> {
    const response = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );
    return response.data.token as string;
  }

  public async applyPlan(plan: AgilePlan, dryRun: boolean, idempotent: boolean = false): Promise<ApplyPlanResult> {
    if (dryRun) {
      return this.generateDryRunReport(plan);
    }
    return this.executePlan(plan, idempotent);
  }

  public async fetchExistingEpics(): Promise<ExistingEpicInfo[]> {
    const milestones = await this.getExistingMilestones('open');
    const epics: ExistingEpicInfo[] = [];

    for (const ms of milestones) {
      const issues = await this.getExistingIssuesByMilestone(ms.number);
      const stories = issues
        .filter(i => !i.title.match(/^\[TS-/))
        .map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          htmlUrl: i.html_url,
        }));

      epics.push({
        number: ms.number,
        title: ms.title,
        description: ms.description,
        state: ms.state,
        htmlUrl: ms.html_url,
        stories,
      });
    }

    return epics;
  }

  public async getExistingMilestones(state: string = 'open'): Promise<GitHubMilestone[]> {
    const response = await this.client.get(`/repos/${this.owner}/${this.repo}/milestones`, {
      params: { state, per_page: 100 },
    });
    return response.data;
  }

  public async getExistingIssuesByMilestone(milestoneNumber: number): Promise<GitHubIssue[]> {
    const response = await this.client.get(`/repos/${this.owner}/${this.repo}/issues`, {
      params: { milestone: milestoneNumber.toString(), state: 'all', per_page: 100 },
    });
    return response.data;
  }

  private async findMilestoneByTitle(title: string): Promise<{ number: number; url: string } | null> {
    const milestones = await this.getExistingMilestones('all');
    const found = milestones.find(ms => ms.title === title);
    return found ? { number: found.number, url: found.html_url } : null;
  }

  private async findIssueByTitle(title: string, milestoneNumber: number): Promise<{ number: number; url: string; nodeId?: string } | null> {
    const issues = await this.getExistingIssuesByMilestone(milestoneNumber);
    const found = issues.find(i => i.title === title);
    return found ? { number: found.number, url: found.html_url, nodeId: found.node_id } : null;
  }

  private generateDryRunReport(plan: AgilePlan): ApplyPlanResult {
    const epic = plan.epic;
    let report = `# Simulation Report (Dry Run) - Agile Plan for GitHub\n\n`;
    report += `The following artifacts will be created in repository **${this.owner}/${this.repo}**:\n\n`;

    if (plan.targetMilestone) {
      report += `## Target Milestone\n`;
      report += `* **Using existing milestone #${plan.targetMilestone}** (no new milestone will be created)\n\n`;
    } else {
      report += `## Milestone (Epic)\n`;
      report += `* **Title:** \`[${epic.id}] ${epic.title}\`\n`;
      report += `* **Description:** ${epic.description}\n\n`;
    }

    report += `## User Stories\n`;
    epic.stories.forEach(story => {
      report += `### \`[${story.id}] ${story.title}\`\n`;
      report += `* **Description:** ${story.description}\n`;
      report += `* **Priority:** ${story.priority} | **Risk:** ${story.risk_level}\n`;
      report += `* **Tags:** ${story.tags.join(', ') || 'None'}\n`;
      report += `* **Label:** \`enhancement\`\n`;
      const totalEffort = story.tasks.reduce((sum, t) => sum + (t.story_points ?? 0), 0);
      report += `* **Effort:** ${this.storyPointsToEffort(totalEffort)}\n`;
      report += `* **Acceptance Criteria:**\n`;
      story.acceptance_criteria.forEach(ac => {
        report += `  - [ ] ${ac}\n`;
      });
      report += `\n`;
    });

    return {
      success: true,
      message: 'Simulation completed successfully. No changes were made on GitHub.',
      report,
    };
  }

  private async executePlan(plan: AgilePlan, idempotent: boolean): Promise<ApplyPlanResult> {
    try {
      let milestoneNumber: number;
      let milestoneUrl: string | undefined;

      if (plan.targetMilestone) {
        milestoneNumber = plan.targetMilestone;
        milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
      } else {
        const milestoneTitle = `[${plan.epic.id}] ${plan.epic.title}`;

        if (idempotent) {
          const existing = await this.findMilestoneByTitle(milestoneTitle);
          if (existing) {
            milestoneNumber = existing.number;
            milestoneUrl = existing.url;
          } else {
            milestoneNumber = await this.createMilestone(milestoneTitle, plan.epic.description);
            milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
          }
        } else {
          milestoneNumber = await this.createMilestone(milestoneTitle, plan.epic.description);
          milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
        }
      }

      const createdStories: Array<{ id: string; number: number; url: string; nodeId?: string }> = [];
      const reusedStories: Array<{ id: string; number: number; url: string; nodeId?: string }> = [];
      const createdTasks: Array<{ id: string; number: number; url: string; nodeId?: string }> = [];
      const reusedTasks: Array<{ id: string; number: number; url: string; nodeId?: string }> = [];
      const taskToNumberMap: Record<string, number> = {};

      for (const story of plan.epic.stories) {
        const storyTitle = `[${story.id}] ${story.title}`;

        if (idempotent) {
          const existing = await this.findIssueByTitle(storyTitle, milestoneNumber);
          if (existing) {
            reusedStories.push({ id: story.id, number: existing.number, url: existing.url, nodeId: existing.nodeId });
            createdStories.push({ id: story.id, number: existing.number, url: existing.url, nodeId: existing.nodeId });
            continue;
          }
        }

        const { number, url, nodeId } = await this.createIssue(
          storyTitle,
          this.buildStoryBody(story),
          milestoneNumber,
          'enhancement'
        );

        createdStories.push({ id: story.id, number, url, nodeId });
      }

      for (const story of plan.epic.stories) {
        const parentStoryMeta = createdStories.find(s => s.id === story.id);
        if (!parentStoryMeta) continue;

        for (const task of story.tasks) {
          const taskTitle = `[${task.id}] ${task.title}`;

          if (idempotent) {
            const existing = await this.findIssueByTitle(taskTitle, milestoneNumber);
            if (existing) {
              reusedTasks.push({ id: task.id, number: existing.number, url: existing.url, nodeId: existing.nodeId });
              taskToNumberMap[task.id] = existing.number;
              continue;
            }
          }

          const taskBody = this.buildTaskBody(task, story.id, parentStoryMeta.url);
          const { number, url, nodeId } = await this.createIssue(
            taskTitle,
            taskBody,
            milestoneNumber
          );

          if (nodeId && parentStoryMeta.nodeId) {
            try {
              await this.addSubIssue(parentStoryMeta.nodeId, nodeId);
            } catch (err) {
              console.error(`Failed to link sub-issue: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          createdTasks.push({ id: task.id, number, url, nodeId });
          taskToNumberMap[task.id] = number;
        }
      }

      // Tasks are linked as sub-issues, no body update needed

      const parts: string[] = [`Plan successfully applied to ${this.owner}/${this.repo}.`];
      if (createdStories.length - reusedStories.length > 0) {
        parts.push(`Created ${createdStories.length - reusedStories.length} stories.`);
      }
      if (reusedStories.length > 0) {
        parts.push(`Reused ${reusedStories.length} existing stories.`);
      }
      if (createdTasks.length > 0) {
        parts.push(`Created ${createdTasks.length} tasks.`);
      }
      if (reusedTasks.length > 0) {
        parts.push(`Reused ${reusedTasks.length} existing tasks.`);
      }

      return {
        success: true,
        message: parts.join(' '),
        milestoneUrl,
        milestoneNumber,
        createdStories: createdStories
          .filter(s => !reusedStories.find(r => r.id === s.id))
          .map(({ id, number, url, nodeId }) => ({ id, number, url, nodeId })),
        createdTasks: createdTasks.filter(t => !reusedTasks.find(r => r.id === t.id)),
        reusedStories: reusedStories.length > 0 ? reusedStories : undefined,
        reusedTasks: reusedTasks.length > 0 ? reusedTasks : undefined,
      };
    } catch (error) {
      const apiError = error as AxiosError;
      const errorMessage = apiError.response
        ? `GitHub API Error (${apiError.response.status}): ${JSON.stringify(apiError.response.data)}`
        : apiError.message;

      return {
        success: false,
        message: 'Error applying plan to GitHub.',
        error: errorMessage,
      };
    }
  }

  public async initializeHarness(): Promise<InitHarnessResult> {
    try {
      await this.client.get(`/repos/${this.owner}/${this.repo}`);

      const milestones = await this.getExistingMilestones('open');
      const isInitialized = milestones.length > 0;

      return {
        success: true,
        message: isInitialized
          ? `Agile Harness is active. Found ${milestones.length} milestone(s).`
          : `Repository connected. No milestones found. Create your first epic with stage_agile_plan + apply_agile_plan.`,
        isInitialized,
        milestonesCount: milestones.length,
        labelsCount: 0,
        labelsCreated: [],
        repoExists: true,
        authValid: true,
      };
    } catch (error) {
      const apiErr = error as AxiosError;
      let message = 'Failed to initialize Agile Harness.';
      let authValid = false;
      let repoExists = false;

      if (apiErr.response) {
        if (apiErr.response.status === 401 || apiErr.response.status === 403) {
          message = 'Authentication failed. Check your GitHub token or App credentials.';
          authValid = false;
        } else if (apiErr.response.status === 404) {
          message = `Repository '${this.owner}/${this.repo}' not found. Check the repository name and access permissions.`;
          repoExists = false;
          authValid = true;
        } else {
          message = `GitHub API Error (${apiErr.response.status}): ${JSON.stringify(apiErr.response.data)}`;
        }
      } else if (apiErr.code === 'ECONNREFUSED' || apiErr.code === 'ENOTFOUND') {
        message = 'Network error: Could not connect to GitHub API.';
      }

      return {
        success: false,
        message,
        isInitialized: false,
        milestonesCount: 0,
        labelsCount: 0,
        labelsCreated: [],
        repoExists,
        authValid,
      };
    }
  }

  private async createMilestone(title: string, description: string): Promise<number> {
    const response = await this.client.post(`/repos/${this.owner}/${this.repo}/milestones`, {
      title,
      description,
    });
    return response.data.number as number;
  }

  private async createIssue(
    title: string,
    body: string,
    milestoneNumber: number,
    label?: string
  ): Promise<{ number: number; url: string; nodeId?: string }> {
    const payload: Record<string, unknown> = {
      title,
      body,
      milestone: milestoneNumber,
    };
    if (label) {
      payload.labels = [label];
    }
    const response = await this.client.post(`/repos/${this.owner}/${this.repo}/issues`, payload);
    return {
      number: response.data.number as number,
      url: response.data.html_url as string,
      nodeId: response.data.node_id as string | undefined,
    };
  }

  private storyPointsToEffort(sp: number | undefined): string {
    if (sp === undefined) return 'Not set';
    if (sp <= 2) return 'Low';
    if (sp <= 5) return 'Medium';
    return 'High';
  }

  private buildStoryBody(story: UserStory): string {
    const totalEffort = story.tasks.reduce((sum, t) => sum + (t.story_points ?? 0), 0);
    return `### Description
${story.description}

### Acceptance Criteria
${story.acceptance_criteria.map(ac => `- [ ] ${ac}`).join('\n')}

### Metadata
- **Priority:** ${story.priority}
- **Risk Level:** ${story.risk_level}
- **Tags:** ${story.tags.join(', ') || 'None'}
- **Effort:** ${this.storyPointsToEffort(totalEffort)}`;
  }

  private buildTaskBody(task: TechnicalTask, parentStoryId: string, parentStoryUrl: string): string {
    const filesList = task.target_files.map(f => `- \`${f}\``).join('\n');
    return `### Description
${task.description}

### Affected Files
${filesList || '- None'}

### Metadata
- **Priority:** ${task.priority}
- **Tags:** ${task.tags.join(', ') || 'None'}
- **Effort:** ${this.storyPointsToEffort(task.story_points)}
- **Parent User Story:** [${parentStoryId}](${parentStoryUrl})`;
  }

  private async addSubIssue(parentIssueId: string, subIssueId: string): Promise<void> {
    const query = `
      mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
        addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId }) {
          issue { id }
        }
      }
    `;
    await this.client.post('/graphql', {
      query,
      variables: {
        issueId: parentIssueId,
        subIssueId: subIssueId,
      },
    }, {
      headers: {
        'Accept': 'application/json',
        'GraphQL-Features': 'sub_issues',
      }
    });
  }
}
