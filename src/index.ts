#!/usr/bin/env node

import { execFileSync } from "child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { AgilePlanner } from "./core/agile_planner.js";
import { GitHubBroker } from "./core/github_broker.js";
import { GitHubProjectsBroker } from "./core/github_projects_broker.js";
import { AuthConfig } from "./core/types.js";

class AgileHarnessServer {
    private server: Server;
    private planner: AgilePlanner;

    constructor() {
        this.server = new Server(
            {
                name: "@jackaranaram/agile-mcp-server",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );
        this.planner = new AgilePlanner();
        this.setupHandlers();
    }

    private resolveAuth(args: Record<string, unknown> | undefined): AuthConfig {
        const token = (args?.githubToken as string) || process.env.GITHUB_TOKEN;
        const appId = (args?.githubAppId as string) || process.env.GITHUB_APP_ID;
        const privateKey = (args?.githubAppPrivateKey as string) || process.env.GITHUB_APP_PRIVATE_KEY;
        const installationId = (args?.githubAppInstallationId as string) || process.env.GITHUB_APP_INSTALLATION_ID;

        if (appId && privateKey && installationId) {
            return { type: 'app', appId, privateKey, installationId };
        }
        if (token) {
            return { type: 'pat', token };
        }
        throw new Error('No authentication found. Provide GITHUB_TOKEN (PAT) or GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID).');
    }

    private resolveRepository(args: Record<string, unknown> | undefined): string | null {
        if (args?.repository) return args.repository as string;
        return this.detectGitRemote();
    }

    private detectGitRemote(): string | null {
        try {
            const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
                cwd: process.cwd(),
                encoding: 'utf-8',
                timeout: 5000,
            }).trim();

            // git@github.com:owner/repo.git → owner/repo
            const sshMatch = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
            if (sshMatch) return sshMatch[1];

            // https://github.com/owner/repo.git → owner/repo
            const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
            if (httpsMatch) return httpsMatch[1];

            return null;
        } catch {
            return null;
        }
    }

    private detectGitOwnerLogin(): string | null {
        const repo = this.detectGitRemote();
        if (repo) {
            const owner = repo.split('/')[0];
            return owner || null;
        }
        return null;
    }

    private setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "stage_agile_plan",
                    description: "Validates and saves a structured Agile Plan (Epic, Stories, Tasks) generated from requirements.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            payload: {
                                type: "object",
                                description: "The full AgilePlan JSON payload. Include targetMilestone (number) to add stories to an existing epic milestone."
                            }
                        },
                        required: ["payload"]
                    }
                } as Tool,
                {
                    name: "apply_agile_plan",
                    description: "Applies the staged Agile Plan to GitHub, creating milestones, issues, and linking them.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN environment variable)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var). If set, App auth is used instead of PAT."
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (PEM) (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            },
                            repository: {
                                type: "string",
                                description: "Target repository in 'owner/repo' format (auto-detected from git remote if omitted)"
                            },
                            dryRun: {
                                type: "boolean",
                                description: "If true, simulates the changes and returns a markdown report. If false, creates them on GitHub. Defaults to true."
                            },
                            idempotent: {
                                type: "boolean",
                                description: "If true, checks if items already exist before creating them, reusing any existing matches. Defaults to false."
                            }
                        }
                    }
                } as Tool,
                {
                    name: "init_agile_harness",
                    description: "Verifies GitHub connectivity and reports the initialization state of the Agile Harness for a repository.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            },
                            repository: {
                                type: "string",
                                description: "Target repository in 'owner/repo' format (auto-detected from git remote if omitted)"
                            }
                        }
                    }
                } as Tool,
                {
                    name: "fetch_existing_epics",
                    description: "Fetches all open milestones (epics) from the GitHub repository with their associated user stories, for AI-driven planning context.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            },
                            repository: {
                                type: "string",
                                description: "Target repository in 'owner/repo' format (auto-detected from git remote if omitted)"
                            }
                        }
                    }
                } as Tool,
                {
                    name: "list_github_projects",
                    description: "Lists GitHub Projects V2 available for a user or organization. Auto-detects owner from git remote if ownerLogin is not provided.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            ownerLogin: {
                                type: "string",
                                description: "GitHub username or organization login (auto-detected from git remote if omitted)"
                            },
                            isOrg: {
                                type: "boolean",
                                description: "If true, lists organization projects. If false, lists user projects. Defaults to false."
                            },
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            }
                        }
                    }
                } as Tool,
                {
                    name: "create_project",
                    description: "Creates a new GitHub Project V2 for a user or organization. Auto-detects owner from git remote if ownerLogin is not provided.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            ownerLogin: {
                                type: "string",
                                description: "GitHub username or organization login (auto-detected from git remote if omitted)"
                            },
                            title: {
                                type: "string",
                                description: "Title for the new project"
                            },
                            shortDescription: {
                                type: "string",
                                description: "Optional short description for the project"
                            },
                            isOrg: {
                                type: "boolean",
                                description: "If true, creates project in an organization. If false, creates user project. Defaults to false."
                            },
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            }
                        },
                        required: ["title"]
                    }
                } as Tool,
                {
                    name: "get_project_fields",
                    description: "Gets the custom fields (columns) available in a GitHub Project V2, including their IDs, types, and option values.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            projectId: {
                                type: "string",
                                description: "Node ID of the GitHub Project V2"
                            },
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            }
                        },
                        required: ["projectId"]
                    }
                } as Tool,
                {
                    name: "sync_project_with_milestones",
                    description: "Fetches items from a GitHub Project V2 and their associated milestones/issues for planning context.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            projectId: {
                                type: "string",
                                description: "Node ID of the GitHub Project V2"
                            },
                            githubToken: {
                                type: "string",
                                description: "GitHub Personal Access Token (defaults to GITHUB_TOKEN env var)"
                            },
                            githubAppId: {
                                type: "string",
                                description: "GitHub App ID (defaults to GITHUB_APP_ID env var)"
                            },
                            githubAppPrivateKey: {
                                type: "string",
                                description: "GitHub App private key (defaults to GITHUB_APP_PRIVATE_KEY env var)"
                            },
                            githubAppInstallationId: {
                                type: "string",
                                description: "GitHub App installation ID (defaults to GITHUB_APP_INSTALLATION_ID env var)"
                            }
                        },
                        required: ["projectId"]
                    }
                } as Tool
            ]
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (request.params.name === "stage_agile_plan") {
                const payload = request.params.arguments?.payload;

                if (!payload) {
                    return {
                        content: [{ type: "text", text: "Error: Missing 'payload' argument." }],
                        isError: true,
                    };
                }

                const result = await this.planner.stagePlan(payload);

                if (result.success) {
                    return {
                        content: [{ type: "text", text: `Success! Plan validated and staged at: ${result.filePath}` }],
                    };
                } else {
                    return {
                        content: [{
                            type: "text",
                            text: `Validation failed:\n${result.errors.join('\n')}\n\nPlease correct your JSON payload and try again.`
                        }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "apply_agile_plan") {
                const stagedPlan = await this.planner.getStagedPlan();
                if (!stagedPlan) {
                    return {
                        content: [{ type: "text", text: "Error: No staged agile plan found. Run 'stage_agile_plan' first." }],
                        isError: true,
                    };
                }

                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const repository = this.resolveRepository(request.params.arguments as Record<string, unknown> | undefined);

                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository not found. Provide it via the 'repository' argument, or run this from a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }

                    const dryRun = request.params.arguments?.dryRun !== false;
                    const idempotent = request.params.arguments?.idempotent === true;

                    const broker = new GitHubBroker(auth, repository);
                    const result = await broker.applyPlan(stagedPlan, dryRun, idempotent);

                    let responseText: string;
                    if (result.success) {
                        responseText = dryRun
                            ? `${result.message}\n\n${result.report}`
                            : `${result.message}\nMilestone URL: ${result.milestoneUrl}\n` +
                              `Created ${result.createdStories?.length || 0} stories and ${result.createdTasks?.length || 0} tasks.` +
                              (result.reusedStories?.length ? `\nReused ${result.reusedStories.length} existing stories.` : '') +
                              (result.reusedTasks?.length ? `\nReused ${result.reusedTasks.length} existing tasks.` : '');
                    } else {
                        return {
                            content: [{ type: "text", text: `Failed to apply plan: ${result.message}\nDetails: ${result.error || ''}` }],
                            isError: true,
                        };
                    }

                    // If targetProject is set, also sync to GitHub Projects V2
                    if (result.success && stagedPlan.targetProject) {
                        const projectBroker = new GitHubProjectsBroker(auth, stagedPlan.targetProject);

                        // Build issueNodeIdMap from created/reused issues for real linking
                        const issueNodeIdMap: Record<string, string> = {};
                        for (const s of [...(result.createdStories || []), ...(result.reusedStories || [])]) {
                            if (s.nodeId) issueNodeIdMap[s.id] = s.nodeId;
                        }
                        for (const t of [...(result.createdTasks || []), ...(result.reusedTasks || [])]) {
                            if (t.nodeId) issueNodeIdMap[t.id] = t.nodeId;
                        }

                        const projectResult = await projectBroker.applyPlanToProject(
                            stagedPlan,
                            {
                                linkToMilestones: stagedPlan.projectOptions?.linkToMilestones ?? false,
                                dryRun: false,
                                idempotent,
                            },
                            issueNodeIdMap,
                        );
                        responseText += `\n\n## GitHub Projects V2\n${projectResult.message}`;
                        if (!projectResult.success) {
                            responseText += `\nProject sync error: ${projectResult.error || ''}`;
                        }
                    }

                    return {
                        content: [{ type: "text", text: responseText }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "init_agile_harness") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const repository = this.resolveRepository(request.params.arguments as Record<string, unknown> | undefined);

                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository not found. Provide it via the 'repository' argument, or run this from a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubBroker(auth, repository);
                    const result = await broker.initializeHarness();

                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "fetch_existing_epics") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const repository = this.resolveRepository(request.params.arguments as Record<string, unknown> | undefined);

                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository not found. Provide it via the 'repository' argument, or run this from a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubBroker(auth, repository);
                    const epics = await broker.fetchExistingEpics();

                    return {
                        content: [{ type: "text", text: JSON.stringify(epics, null, 2) }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "list_github_projects") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const ownerLogin = (request.params.arguments?.ownerLogin as string) || this.detectGitOwnerLogin() || '';
                    const isOrg = request.params.arguments?.isOrg === true;

                    if (!ownerLogin) {
                        return {
                            content: [{ type: "text", text: "Error: 'ownerLogin' is required. Provide it as argument or be inside a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubProjectsBroker(auth, '');
                    const projects = await broker.listProjects(ownerLogin, isOrg);

                    if (projects.length === 0) {
                        return {
                            content: [{ type: "text", text: `No GitHub Projects V2 found for ${isOrg ? 'organization' : 'user'} '${ownerLogin}'.` }],
                        };
                    }

                    const text = projects.map((p) =>
                        `* **${p.title}** (#${p.number}) — ID: \`${p.id}\`${p.shortDescription ? ` — ${p.shortDescription}` : ''}${p.closed ? ' (closed)' : ''}`
                    ).join('\n');

                    return {
                        content: [{ type: "text", text: `## GitHub Projects V2 for '${ownerLogin}'\n\n${text}` }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "create_project") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const ownerLogin = (request.params.arguments?.ownerLogin as string) || this.detectGitOwnerLogin() || '';
                    const title = request.params.arguments?.title as string;
                    const isOrg = request.params.arguments?.isOrg === true;
                    if (!ownerLogin || !title) {
                        return {
                            content: [{ type: "text", text: `Error: 'title' is required.${!ownerLogin ? " 'ownerLogin' is required too — provide it or be inside a git repository with a GitHub remote." : ''}` }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubProjectsBroker(auth, '');
                    const owner = await broker.getOwnerId(ownerLogin);

                    if (isOrg && owner.type === 'USER') {
                        return {
                            content: [{ type: "text", text: `Error: '${ownerLogin}' is a user, not an organization. Set isOrg=false or use an org login.` }],
                            isError: true,
                        };
                    }

                    if (!isOrg && owner.type === 'ORGANIZATION') {
                        return {
                            content: [{ type: "text", text: `Error: '${ownerLogin}' is an organization. Set isOrg=true to create a project in this organization.` }],
                            isError: true,
                        };
                    }

                    const project = await broker.createProject(owner.id, title);

                    const manualInstructions = `\n\n---\n## Guía de configuración del Project\n\n` +
                        `### 1. Campo Status — Flujo completo de 5 estados\n` +
                        `El proyecto se crea con 3 estados por defecto: **Todo**, **In Progress**, **Done**. ` +
                        `Para completar el flujo ágil, agrega **Backlog** e **In Review**:\n\n` +
                        `**Paso a paso:**\n` +
                        `   1. Abre el proyecto en tu navegador: \`https://github.com/users/${ownerLogin}/projects/${project.number}\`\n` +
                        `   2. Haz clic en **"..."** → **Settings**\n` +
                        `   3. Busca el campo **Status** → **Edit field**\n` +
                        `   4. En **Options**, haz clic en **"Add option"** y agrega:\n\n` +
                        `      | Opción        | Descripción                                            | Color |\n` +
                        `      |--------------|--------------------------------------------------------|-------|\n` +
                        `      | **Backlog**   | Unprioritized ideas and pending tasks                  | GRAY  |\n` +
                        `      | **Todo**      | Prioritized tasks ready to start                       | BLUE  |\n` +
                        `      | **In Progress** | Actively being worked on                             | YELLOW |\n` +
                        `      | **In Review** | Completed tasks pending review / QA                     | PURPLE |\n` +
                        `      | **Done**      | Finished and accepted tasks                            | GREEN |\n\n` +
                        `   5. Ingresa la **descripción** para cada opción (opcional)\n` +
                        `   6. Selecciona el **color** recomendado\n` +
                        `   7. Haz clic en **"Save"**\n\n` +
                        `> **💡 Tip:** Si ya tienes Todo, In Progress, Done — solo agrega **Backlog** al inicio e **In Review** entre medias.\n\n` +
                        `### 2. Workflows de GitHub Projects (Automatización)\n` +
                        `Ve a la pestaña **Workflows** → **"Add workflow"** y configura según los 5 estados:\n\n` +
                        `   | Workflow                      | Trigger / Acción                            | Status objetivo |\n` +
                        `   |------------------------------|---------------------------------------------|-----------------|\n` +
                        `   | **Auto-add sub-issues**       | When a sub-issue is added                   | **Backlog**     |\n` +
                        `   | **Auto-add to project**       | When an item matches rules                  | **Backlog**     |\n` +
                        `   | **Item added to project**     | When any item is added                      | **Backlog**     |\n` +
                        `   | **Code changes requested**    | When changes are requested on a PR          | **Todo**        |\n` +
                        `   | **Item reopened**             | When a closed item is reopened              | **Todo**        |\n` +
                        `   | **Pull request linked to issue** | When a PR links to an issue              | **In Review**   |\n` +
                        `   | **Code review approved**      | When a review is approved                   | **Done**        |\n` +
                        `   | **Pull request merged**       | When a PR is merged                         | **Done**        |\n` +
                        `   | **Item closed**               | When an item is closed                      | **Done**        |\n` +
                        `   | **Auto-close issue**          | When status is Done → close the issue       | *(cierra issue)* |\n` +
                        `   | **Auto-archive items**        | When status is Done → archive the item      | *(archiva)*     |\n\n` +
                        `### 3. Siguientes pasos — Aplicar un plan ágil\n` +
                        `Ahora que el proyecto está listo, sigue este flujo:\n\n` +
                        `   **Paso 1:** \`fetch_existing_epics\` — Revisa milestones e issues existentes para contexto\n` +
                        `   **Paso 2:** \`stage_agile_plan\` — Crea y valida tu plan JSON (incluye \`targetProject\` con el ID de este proyecto para auto-sincronizar)\n` +
                        `   **Paso 3:** \`apply_agile_plan\` — Publica en GitHub (crea milestones, issues y sincroniza con este proyecto)\n\n` +
                        `   > Para que el plan sincronice campos (Type, Priority, Risk, Story Points), créalos manualmente en ` +
                        `**Settings → Fields → + Add field**.`;

                    return {
                        content: [{ type: "text", text: `Project created successfully!\n\n* **${project.title}** (#${project.number}) — ID: \`${project.id}\`\n* URL: \`${project.url || `https://github.com/users/${ownerLogin}/projects/${project.number}`}\`${manualInstructions}` }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "get_project_fields") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const projectId = request.params.arguments?.projectId as string;

                    if (!projectId) {
                        return {
                            content: [{ type: "text", text: "Error: 'projectId' argument is required." }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubProjectsBroker(auth, projectId);
                    const fields = await broker.getProjectFields();

                    const text = fields.map((f) => {
                        let line = `* **${f.name}** (ID: \`${f.id}\`, type: ${f.dataType})`;
                        if (f.options && f.options.length > 0) {
                            line += `\n  Options: ${f.options.map((o) => `${o.name} (\`${o.id}\`)`).join(', ')}`;
                        }
                        return line;
                    }).join('\n');

                    return {
                        content: [{ type: "text", text: `## Project Fields\n\n${text}` }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            if (request.params.name === "sync_project_with_milestones") {
                try {
                    const auth = this.resolveAuth(request.params.arguments as Record<string, unknown> | undefined);
                    const projectId = request.params.arguments?.projectId as string;

                    if (!projectId) {
                        return {
                            content: [{ type: "text", text: "Error: 'projectId' argument is required." }],
                            isError: true,
                        };
                    }

                    const broker = new GitHubProjectsBroker(auth, projectId);
                    const items = await broker.getProjectItems();

                    const text = items.map((item) => {
                        let line = `* **${item.content?.title ?? 'Untitled'}** (type: ${item.type})`;
                        if (item.content?.number) {
                            line += ` — Issue #${item.content.number}`;
                        }
                        if (item.content?.url) {
                            line += ` — ${item.content.url}`;
                        }
                        const fields = Object.entries(item.fieldValues);
                        if (fields.length > 0) {
                            line += `\n  Fields: ${fields.map(([k, v]) => `${k}=${v}`).join(', ')}`;
                        }
                        return line;
                    }).join('\n');

                    return {
                        content: [{ type: "text", text: `## Project Items (${items.length} total)\n\n${text || 'No items found.'}` }],
                    };
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }

            throw new Error(`Tool not found: ${request.params.name}`);
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("@jackaranaram/agile-mcp-server running on stdio");
    }
}

const server = new AgileHarnessServer();
server.run().catch(console.error);
