"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubBroker = void 0;
const axios_1 = __importDefault(require("axios"));
class GitHubBroker {
    client;
    owner;
    repo;
    constructor(token, repository, baseUrl = 'https://api.github.com') {
        const parts = repository.split('/');
        if (parts.length !== 2) {
            throw new Error(`Invalid repository format: "${repository}". Expected "owner/repo".`);
        }
        this.owner = parts[0];
        this.repo = parts[1];
        this.client = axios_1.default.create({
            baseURL: baseUrl,
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
    }
    /**
     * Applies the staged agile plan to GitHub, or generates a dry-run report.
     */
    async applyPlan(plan, dryRun) {
        if (dryRun) {
            return this.generateDryRunReport(plan);
        }
        return this.executePlan(plan);
    }
    /**
     * Generates a markdown report describing what actions would be taken.
     */
    generateDryRunReport(plan) {
        const epic = plan.epic;
        let report = `# Reporte de Simulación (Dry Run) - Plan Ágil para GitHub\n\n`;
        report += `Se simulará la creación de los siguientes artefactos en el repositorio **${this.owner}/${this.repo}**:\n\n`;
        report += `## 📌 Hito (Milestone - Epic)\n`;
        report += `* **Título:** \`[${epic.id}] ${epic.title}\`\n`;
        report += `* **Descripción:** ${epic.description}\n\n`;
        report += `## 🏷️ Etiquetas a Crear (Labels)\n`;
        const labels = this.collectRequiredLabels(plan);
        labels.forEach(l => {
            report += `* Label: \`${l.name}\` (Color: \`#${l.color}\`)\n`;
        });
        report += `\n`;
        report += `## 📖 Historias de Usuario (User Stories)\n`;
        epic.stories.forEach(story => {
            report += `### 🟢 \`[${story.id}] ${story.title}\`\n`;
            report += `* **Descripción:** ${story.description}\n`;
            report += `* **Prioridad:** ${story.priority} | **Riesgo:** ${story.risk_level}\n`;
            report += `* **Etiquetas:** ${story.tags.join(', ') || 'Ninguna'}\n`;
            report += `* **Criterios de Aceptación:**\n`;
            story.acceptance_criteria.forEach(ac => {
                report += `  - [ ] ${ac}\n`;
            });
            report += `* **Tareas Técnicas Asociadas:**\n`;
            story.tasks.forEach(task => {
                report += `  - [ ] \`[${task.id}] ${task.title}\` (Archivos: \`${task.target_files.join(', ') || 'Ninguno'}\`)\n`;
            });
            report += `\n`;
        });
        return {
            success: true,
            message: 'Simulación completada con éxito. No se realizaron cambios en GitHub.',
            report,
        };
    }
    /**
     * Executes the plan by calling the GitHub REST API.
     */
    async executePlan(plan) {
        try {
            // 1. Ensure all labels exist
            const labels = this.collectRequiredLabels(plan);
            for (const label of labels) {
                await this.ensureLabelExists(label.name, label.color);
            }
            // 2. Create Milestone for Epic
            const milestoneNumber = await this.createMilestone(`[${plan.epic.id}] ${plan.epic.title}`, plan.epic.description);
            const createdStories = [];
            const createdTasks = [];
            const taskToNumberMap = {};
            // 3. Create User Stories
            for (const story of plan.epic.stories) {
                const storyLabels = [
                    'type:story',
                    `priority:${story.priority}`,
                    `risk:${story.risk_level}`,
                    ...story.tags
                ];
                const initialBody = this.buildStoryBody(story);
                const { number, url } = await this.createIssue(`[${story.id}] ${story.title}`, initialBody, milestoneNumber, storyLabels);
                createdStories.push({ id: story.id, number, url, rawBody: initialBody });
            }
            // 4. Create Technical Tasks
            for (const story of plan.epic.stories) {
                const parentStoryMeta = createdStories.find(s => s.id === story.id);
                if (!parentStoryMeta)
                    continue;
                for (const task of story.tasks) {
                    const taskLabels = [
                        'type:task',
                        `priority:${task.priority}`,
                        ...task.tags
                    ];
                    const taskBody = this.buildTaskBody(task, story.id, parentStoryMeta.url);
                    const { number, url } = await this.createIssue(`[${task.id}] ${task.title}`, taskBody, milestoneNumber, taskLabels);
                    createdTasks.push({ id: task.id, number, url });
                    taskToNumberMap[task.id] = number;
                }
            }
            // 5. Update User Stories with Tasklists
            for (const story of plan.epic.stories) {
                const createdStory = createdStories.find(s => s.id === story.id);
                if (!createdStory)
                    continue;
                const tasksListMarkdown = story.tasks.map(task => {
                    const taskNumber = taskToNumberMap[task.id];
                    return `- [ ] #${taskNumber} [${task.id}] ${task.title}`;
                }).join('\n');
                const updatedBody = createdStory.rawBody.replace('<!-- TASKS_PLACEHOLDER -->', tasksListMarkdown);
                await this.updateIssueBody(createdStory.number, updatedBody);
            }
            return {
                success: true,
                message: `Plan ágil aplicado con éxito al repositorio ${this.owner}/${this.repo}.`,
                milestoneUrl: `https://github.com/${this.owner}/${this.repo}/milestone/${milestoneNumber}`,
                createdStories: createdStories.map(({ id, number, url }) => ({ id, number, url })),
                createdTasks,
            };
        }
        catch (error) {
            const apiError = error;
            const errorMessage = apiError.response
                ? `GitHub API Error (${apiError.response.status}): ${JSON.stringify(apiError.response.data)}`
                : apiError.message;
            return {
                success: false,
                message: 'Error al aplicar el plan en GitHub.',
                error: errorMessage,
            };
        }
    }
    /**
     * Helper to collect all labels to ensure.
     */
    collectRequiredLabels(plan) {
        const labelMap = new Map();
        // Standard types
        labelMap.set('type:epic', '3498DB');
        labelMap.set('type:story', '2ECC71');
        labelMap.set('type:task', '9B59B6');
        // Priorities
        labelMap.set('priority:LOW', 'D4E6F1');
        labelMap.set('priority:MEDIUM', 'FADBD8');
        labelMap.set('priority:HIGH', 'F5B041');
        labelMap.set('priority:CRITICAL', 'EC7063');
        // Risks
        labelMap.set('risk:LOW', 'A9DFBF');
        labelMap.set('risk:MEDIUM', 'F9E79F');
        labelMap.set('risk:HIGH', 'F1948A');
        // Custom tags
        const collectTags = (tags) => {
            tags.forEach(tag => {
                if (!labelMap.has(tag)) {
                    labelMap.set(tag, 'D5D8DC'); // Default gray color for custom tags
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
    /**
     * Ensures a label exists, creating it if it doesn't.
     */
    async ensureLabelExists(name, color) {
        try {
            await this.client.post(`/repos/${this.owner}/${this.repo}/labels`, {
                name,
                color,
                description: `Creada por Agile Agent Harness`,
            });
        }
        catch (error) {
            const apiError = error;
            // 422 indicates the label already exists
            if (apiError.response?.status !== 422) {
                throw error;
            }
        }
    }
    /**
     * Creates a Milestone.
     */
    async createMilestone(title, description) {
        const response = await this.client.post(`/repos/${this.owner}/${this.repo}/milestones`, {
            title,
            description,
        });
        return response.data.number;
    }
    /**
     * Creates an Issue.
     */
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
        };
    }
    /**
     * Updates an Issue's body.
     */
    async updateIssueBody(issueNumber, body) {
        await this.client.patch(`/repos/${this.owner}/${this.repo}/issues/${issueNumber}`, {
            body,
        });
    }
    /**
     * Story Body Builder.
     */
    buildStoryBody(story) {
        return `### Descripción
${story.description}

### Criterios de Aceptación
${story.acceptance_criteria.map(ac => `- [ ] ${ac}`).join('\n')}

### Metadatos
- **Prioridad:** ${story.priority}
- **Nivel de Riesgo:** ${story.risk_level}
- **Etiquetas:** ${story.tags.join(', ') || 'Ninguna'}

### Tareas Técnicas
<!-- TASKS_PLACEHOLDER -->`;
    }
    /**
     * Task Body Builder.
     */
    buildTaskBody(task, parentStoryId, parentStoryUrl) {
        const filesList = task.target_files.map(f => `- \`${f}\``).join('\n');
        return `### Descripción
${task.description}

### Archivos Afectados
${filesList || '- Ninguno'}

### Metadatos
- **Prioridad:** ${task.priority}
- **Etiquetas:** ${task.tags.join(', ') || 'Ninguna'}
- **Historia de Usuario Padre:** [${parentStoryId}](${parentStoryUrl})`;
    }
}
exports.GitHubBroker = GitHubBroker;
