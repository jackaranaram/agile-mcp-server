"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubBroker = void 0;
const axios_1 = __importDefault(require("axios"));
const axios_retry_1 = __importDefault(require("axios-retry"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const STANDARD_LABELS = [
    { name: 'type:epic', color: '3498DB' },
    { name: 'type:story', color: '2ECC71' },
    { name: 'type:task', color: '9B59B6' },
    { name: 'priority:LOW', color: 'D4E6F1' },
    { name: 'priority:MEDIUM', color: 'FADBD8' },
    { name: 'priority:HIGH', color: 'F5B041' },
    { name: 'priority:CRITICAL', color: 'EC7063' },
    { name: 'risk:LOW', color: 'A9DFBF' },
    { name: 'risk:MEDIUM', color: 'F9E79F' },
    { name: 'risk:HIGH', color: 'F1948A' },
];
class GitHubBroker {
    client;
    owner;
    repo;
    authMode;
    currentToken = null;
    tokenExpiresAt = null;
    constructor(auth, repository, baseUrl = 'https://api.github.com') {
        const parts = repository.split('/');
        if (parts.length !== 2) {
            throw new Error(`Invalid repository format: "${repository}". Expected "owner/repo".`);
        }
        this.owner = parts[0];
        this.repo = parts[1];
        this.authMode = auth;
        this.client = axios_1.default.create({
            baseURL: baseUrl,
            headers: {
                Accept: 'application/vnd.github.v3+json',
            },
        });
        this.setupInterceptor();
        this.setupRateLimiting();
    }
    setupInterceptor() {
        this.client.interceptors.request.use(async (config) => {
            const token = await this.resolveToken();
            config.headers.Authorization = this.authMode.type === 'pat' ? `token ${token}` : `Bearer ${token}`;
            return config;
        });
    }
    setupRateLimiting() {
        (0, axios_retry_1.default)(this.client, {
            retries: 3,
            retryDelay: axios_retry_1.default.exponentialDelay,
            retryCondition: (error) => {
                const status = error.response?.status;
                return status === 429 || status === 500 || status === 502 || status === 503;
            },
        });
        this.client.interceptors.response.use((response) => {
            const remaining = response.headers?.['x-ratelimit-remaining'];
            if (remaining !== undefined && parseInt(remaining) < 10) {
                const resetTime = parseInt(response.headers['x-ratelimit-reset'] || '0');
                const waitMs = Math.max(0, resetTime * 1000 - Date.now() + 1000);
                if (waitMs > 0) {
                    return new Promise(resolve => setTimeout(() => resolve(response), waitMs));
                }
            }
            return response;
        }, (error) => Promise.reject(error));
    }
    async resolveToken() {
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
    generateAppJwt(appId, privateKey) {
        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iat: now - 60,
            exp: now + 600,
            iss: appId,
        };
        return jsonwebtoken_1.default.sign(payload, privateKey, { algorithm: 'RS256' });
    }
    async fetchInstallationToken(jwtToken, installationId) {
        const response = await axios_1.default.post(`https://api.github.com/app/installations/${installationId}/access_tokens`, {}, {
            headers: {
                Authorization: `Bearer ${jwtToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        return response.data.token;
    }
    async applyPlan(plan, dryRun, idempotent = false) {
        if (dryRun) {
            return this.generateDryRunReport(plan);
        }
        return this.executePlan(plan, idempotent);
    }
    async fetchExistingEpics() {
        const milestones = await this.getExistingMilestones('open');
        const epics = [];
        for (const ms of milestones) {
            const issues = await this.getExistingIssuesByMilestone(ms.number);
            const stories = issues
                .filter(i => i.labels.some(l => l.name === 'type:story'))
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
    async getExistingMilestones(state = 'open') {
        const response = await this.client.get(`/repos/${this.owner}/${this.repo}/milestones`, {
            params: { state, per_page: 100 },
        });
        return response.data;
    }
    async getExistingIssuesByMilestone(milestoneNumber) {
        const response = await this.client.get(`/repos/${this.owner}/${this.repo}/issues`, {
            params: { milestone: milestoneNumber.toString(), state: 'all', per_page: 100 },
        });
        return response.data;
    }
    async getExistingLabels() {
        const response = await this.client.get(`/repos/${this.owner}/${this.repo}/labels`, {
            params: { per_page: 100 },
        });
        return response.data;
    }
    async findMilestoneByTitle(title) {
        const milestones = await this.getExistingMilestones('all');
        const found = milestones.find(ms => ms.title === title);
        return found ? { number: found.number, url: found.html_url } : null;
    }
    async findIssueByTitle(title, milestoneNumber) {
        const issues = await this.getExistingIssuesByMilestone(milestoneNumber);
        const found = issues.find(i => i.title === title);
        return found ? { number: found.number, url: found.html_url, nodeId: found.node_id } : null;
    }
    generateDryRunReport(plan) {
        const epic = plan.epic;
        let report = `# Simulation Report (Dry Run) - Agile Plan for GitHub\n\n`;
        report += `The following artifacts will be created in repository **${this.owner}/${this.repo}**:\n\n`;
        if (plan.targetMilestone) {
            report += `## Target Milestone\n`;
            report += `* **Using existing milestone #${plan.targetMilestone}** (no new milestone will be created)\n\n`;
        }
        else {
            report += `## Milestone (Epic)\n`;
            report += `* **Title:** \`[${epic.id}] ${epic.title}\`\n`;
            report += `* **Description:** ${epic.description}\n\n`;
        }
        report += `## Labels to Create\n`;
        const labels = this.collectRequiredLabels(plan);
        labels.forEach(l => {
            report += `* Label: \`${l.name}\` (Color: \`#${l.color}\`)\n`;
        });
        report += `\n`;
        report += `## User Stories\n`;
        epic.stories.forEach(story => {
            report += `### \`[${story.id}] ${story.title}\`\n`;
            report += `* **Description:** ${story.description}\n`;
            report += `* **Priority:** ${story.priority} | **Risk:** ${story.risk_level}\n`;
            report += `* **Tags:** ${story.tags.join(', ') || 'None'}\n`;
            report += `* **Acceptance Criteria:**\n`;
            story.acceptance_criteria.forEach(ac => {
                report += `  - [ ] ${ac}\n`;
            });
            report += `* **Technical Tasks:**\n`;
            story.tasks.forEach(task => {
                report += `  - [ ] \`[${task.id}] ${task.title}\` (Files: \`${task.target_files.join(', ') || 'None'}\`)\n`;
            });
            report += `\n`;
        });
        return {
            success: true,
            message: 'Simulation completed successfully. No changes were made on GitHub.',
            report,
        };
    }
    async executePlan(plan, idempotent) {
        try {
            const skipMetadata = !!plan.targetProject;
            const labels = this.collectRequiredLabels(plan, skipMetadata);
            for (const label of labels) {
                await this.ensureLabelExists(label.name, label.color);
            }
            let milestoneNumber;
            let milestoneUrl;
            if (plan.targetMilestone) {
                milestoneNumber = plan.targetMilestone;
                milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
            }
            else {
                const milestoneTitle = `[${plan.epic.id}] ${plan.epic.title}`;
                if (idempotent) {
                    const existing = await this.findMilestoneByTitle(milestoneTitle);
                    if (existing) {
                        milestoneNumber = existing.number;
                        milestoneUrl = existing.url;
                    }
                    else {
                        milestoneNumber = await this.createMilestone(milestoneTitle, plan.epic.description);
                        milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
                    }
                }
                else {
                    milestoneNumber = await this.createMilestone(milestoneTitle, plan.epic.description);
                    milestoneUrl = `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`;
                }
            }
            const createdStories = [];
            const reusedStories = [];
            const createdTasks = [];
            const reusedTasks = [];
            const taskToNumberMap = {};
            for (const story of plan.epic.stories) {
                const storyLabels = skipMetadata
                    ? [...story.tags]
                    : [
                        'type:story',
                        `priority:${story.priority}`,
                        `risk:${story.risk_level}`,
                        ...story.tags,
                    ];
                const storyTitle = `[${story.id}] ${story.title}`;
                if (idempotent) {
                    const existing = await this.findIssueByTitle(storyTitle, milestoneNumber);
                    if (existing) {
                        reusedStories.push({ id: story.id, number: existing.number, url: existing.url, nodeId: existing.nodeId });
                        createdStories.push({ id: story.id, number: existing.number, url: existing.url, nodeId: existing.nodeId, rawBody: '' });
                        continue;
                    }
                }
                const initialBody = this.buildStoryBody(story);
                const { number, url, nodeId } = await this.createIssue(storyTitle, initialBody, milestoneNumber, storyLabels);
                createdStories.push({ id: story.id, number, url, nodeId, rawBody: initialBody });
            }
            for (const story of plan.epic.stories) {
                const parentStoryMeta = createdStories.find(s => s.id === story.id);
                if (!parentStoryMeta)
                    continue;
                for (const task of story.tasks) {
                    const taskLabels = skipMetadata
                        ? [...task.tags]
                        : [
                            'type:task',
                            `priority:${task.priority}`,
                            ...task.tags,
                        ];
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
                    const { number, url, nodeId } = await this.createIssue(taskTitle, taskBody, milestoneNumber, taskLabels);
                    if (nodeId && parentStoryMeta.nodeId) {
                        try {
                            await this.addSubIssue(parentStoryMeta.nodeId, nodeId);
                        }
                        catch (err) {
                            console.error(`Failed to link sub-issue: ${err instanceof Error ? err.message : String(err)}`);
                        }
                    }
                    createdTasks.push({ id: task.id, number, url, nodeId });
                    taskToNumberMap[task.id] = number;
                }
            }
            for (const story of plan.epic.stories) {
                const createdStory = createdStories.find(s => s.id === story.id);
                if (!createdStory)
                    continue;
                const existingReused = reusedStories.find(s => s.id === story.id);
                if (existingReused)
                    continue;
                const tasksListMarkdown = story.tasks.map(task => {
                    const taskNumber = taskToNumberMap[task.id];
                    if (!taskNumber)
                        return '';
                    return `- [ ] #${taskNumber} [${task.id}] ${task.title}`;
                }).filter(Boolean).join('\n');
                if (tasksListMarkdown) {
                    const updatedBody = createdStory.rawBody.replace('<!-- TASKS_PLACEHOLDER -->', tasksListMarkdown);
                    await this.updateIssueBody(createdStory.number, updatedBody);
                }
            }
            const parts = [`Plan successfully applied to ${this.owner}/${this.repo}.`];
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
        }
        catch (error) {
            const apiError = error;
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
    async initializeHarness() {
        try {
            await this.client.get(`/repos/${this.owner}/${this.repo}`);
            const existingLabels = await this.getExistingLabels();
            const existingNames = new Set(existingLabels.map(l => l.name));
            const labelsCreated = [];
            for (const label of STANDARD_LABELS) {
                if (!existingNames.has(label.name)) {
                    try {
                        await this.ensureLabelExists(label.name, label.color);
                        labelsCreated.push(label.name);
                    }
                    catch {
                        // non-422 error, skip
                    }
                }
            }
            const milestones = await this.getExistingMilestones('open');
            const isInitialized = milestones.length > 0;
            const totalLabels = existingLabels.length + labelsCreated.length;
            return {
                success: true,
                message: isInitialized
                    ? `Agile Harness is active. Found ${milestones.length} milestone(s) and ${totalLabels} labels.${labelsCreated.length ? ` Created ${labelsCreated.length} new label(s).` : ''}`
                    : `Repository initialized. Verified ${totalLabels} labels${labelsCreated.length ? ` (${labelsCreated.length} new)` : ''}. No milestones found. Create your first epic with stage_agile_plan + apply_agile_plan.`,
                isInitialized,
                milestonesCount: milestones.length,
                labelsCount: totalLabels,
                labelsCreated,
                repoExists: true,
                authValid: true,
            };
        }
        catch (error) {
            const apiErr = error;
            let message = 'Failed to initialize Agile Harness.';
            let authValid = false;
            let repoExists = false;
            if (apiErr.response) {
                if (apiErr.response.status === 401 || apiErr.response.status === 403) {
                    message = 'Authentication failed. Check your GitHub token or App credentials.';
                    authValid = false;
                }
                else if (apiErr.response.status === 404) {
                    message = `Repository '${this.owner}/${this.repo}' not found. Check the repository name and access permissions.`;
                    repoExists = false;
                    authValid = true;
                }
                else {
                    message = `GitHub API Error (${apiErr.response.status}): ${JSON.stringify(apiErr.response.data)}`;
                }
            }
            else if (apiErr.code === 'ECONNREFUSED' || apiErr.code === 'ENOTFOUND') {
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
    collectRequiredLabels(plan, skipMetadata = false) {
        const labelMap = new Map();
        STANDARD_LABELS.forEach(l => {
            if (skipMetadata) {
                if (l.name === 'type:epic') {
                    labelMap.set(l.name, l.color);
                }
            }
            else {
                labelMap.set(l.name, l.color);
            }
        });
        const collectTags = (tags) => {
            tags.forEach(tag => {
                if (!labelMap.has(tag)) {
                    labelMap.set(tag, 'D5D8DC');
                }
            });
        };
        collectTags(plan.epic.tags);
        plan.epic.stories.forEach(story => {
            collectTags(story.tags);
            story.tasks.forEach(task => {
                collectTags(task.tags);
            });
        });
        return Array.from(labelMap.entries()).map(([name, color]) => ({ name, color }));
    }
    async ensureLabelExists(name, color) {
        try {
            await this.client.post(`/repos/${this.owner}/${this.repo}/labels`, {
                name,
                color,
                description: `Created by Agile Agent Harness`,
            });
        }
        catch (error) {
            const apiError = error;
            if (apiError.response?.status !== 422) {
                throw error;
            }
        }
    }
    async createMilestone(title, description) {
        const response = await this.client.post(`/repos/${this.owner}/${this.repo}/milestones`, {
            title,
            description,
        });
        return response.data.number;
    }
    async createIssue(title, body, milestoneNumber, labels) {
        const response = await this.client.post(`/repos/${this.owner}/${this.repo}/issues`, {
            title,
            body,
            milestone: milestoneNumber,
            labels,
        });
        return {
            number: response.data.number,
            url: response.data.html_url,
            nodeId: response.data.node_id,
        };
    }
    async updateIssueBody(issueNumber, body) {
        await this.client.patch(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
            body,
        });
    }
    buildStoryBody(story) {
        return `### Description
${story.description}

### Acceptance Criteria
${story.acceptance_criteria.map(ac => `- [ ] ${ac}`).join('\n')}

### Metadata
- **Priority:** ${story.priority}
- **Risk Level:** ${story.risk_level}
- **Tags:** ${story.tags.join(', ') || 'None'}

### Technical Tasks
<!-- TASKS_PLACEHOLDER -->`;
    }
    buildTaskBody(task, parentStoryId, parentStoryUrl) {
        const filesList = task.target_files.map(f => `- \`${f}\``).join('\n');
        return `### Description
${task.description}

### Affected Files
${filesList || '- None'}

### Metadata
- **Priority:** ${task.priority}
- **Tags:** ${task.tags.join(', ') || 'None'}
- **Parent User Story:** [${parentStoryId}](${parentStoryUrl})`;
    }
    async addSubIssue(parentIssueId, subIssueId) {
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
exports.GitHubBroker = GitHubBroker;
