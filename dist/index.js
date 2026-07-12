#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const agile_planner_js_1 = require("./core/agile_planner.js");
const github_broker_js_1 = require("./core/github_broker.js");
const github_projects_broker_js_1 = require("./core/github_projects_broker.js");
class AgileHarnessServer {
    server;
    planner;
    constructor() {
        this.server = new index_js_1.Server({
            name: "@jackaranaram/agile-mcp-server",
            version: "1.0.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.planner = new agile_planner_js_1.AgilePlanner();
        this.setupHandlers();
    }
    resolveAuth(args) {
        const token = args?.githubToken || process.env.GITHUB_TOKEN;
        const appId = args?.githubAppId || process.env.GITHUB_APP_ID;
        const privateKey = args?.githubAppPrivateKey || process.env.GITHUB_APP_PRIVATE_KEY;
        const installationId = args?.githubAppInstallationId || process.env.GITHUB_APP_INSTALLATION_ID;
        if (appId && privateKey && installationId) {
            return { type: 'app', appId, privateKey, installationId };
        }
        if (token) {
            return { type: 'pat', token };
        }
        throw new Error('No authentication found. Provide GITHUB_TOKEN (PAT) or GitHub App credentials (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID).');
    }
    resolveRepository(args) {
        if (args?.repository)
            return args.repository;
        if (process.env.GITHUB_REPOSITORY)
            return process.env.GITHUB_REPOSITORY;
        return this.detectGitRemote() || '';
    }
    detectGitRemote() {
        try {
            const url = (0, child_process_1.execFileSync)('git', ['remote', 'get-url', 'origin'], {
                cwd: process.cwd(),
                encoding: 'utf-8',
                timeout: 5000,
            }).trim();
            // git@github.com:owner/repo.git → owner/repo
            const sshMatch = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
            if (sshMatch)
                return sshMatch[1];
            // https://github.com/owner/repo.git → owner/repo
            const httpsMatch = url.match(/github\.com\/(.+?)(?:\.git)?$/);
            if (httpsMatch)
                return httpsMatch[1];
            return null;
        }
        catch {
            return null;
        }
    }
    detectGitOwnerLogin() {
        const repo = this.detectGitRemote();
        if (repo) {
            const owner = repo.split('/')[0];
            return owner || null;
        }
        return null;
    }
    setupHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
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
                },
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
                                description: "Target repository in 'owner/repo' format (defaults to GITHUB_REPOSITORY environment variable)"
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
                },
                {
                    name: "init_agile_harness",
                    description: "Verifies GitHub connectivity, ensures standard labels exist, and reports the initialization state of the Agile Harness for a repository.",
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
                },
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
                },
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
                },
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
                },
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
                },
                {
                    name: "apply_plan_to_project",
                    description: "Applies the staged Agile Plan to a GitHub Project V2, creating draft issues (or adding existing issues) and setting custom fields (Type, Priority, Risk, Story Points).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            projectId: {
                                type: "string",
                                description: "Node ID of the GitHub Project V2"
                            },
                            createAsDraftIssues: {
                                type: "boolean",
                                description: "If true, creates draft issues in the project. If false, adds existing issues by node ID (requires issueNodeIdMap). Defaults to true."
                            },
                            dryRun: {
                                type: "boolean",
                                description: "If true, simulates changes and returns a markdown report. Defaults to true."
                            },
                            idempotent: {
                                type: "boolean",
                                description: "If true, checks if items already exist before creating them. Defaults to false."
                            },
                            issueNodeIdMap: {
                                type: "object",
                                description: "Optional mapping of story/task IDs to GitHub node IDs (e.g. {\"STORY-1\": \"node_id_xxx\"}). Used when createAsDraftIssues=false to add existing issues to the project."
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
                },
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
                }
            ]
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
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
                }
                else {
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
                    const auth = this.resolveAuth(request.params.arguments);
                    const repository = this.resolveRepository(request.params.arguments);
                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument, GITHUB_REPOSITORY env var, or be inside a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }
                    const dryRun = request.params.arguments?.dryRun !== false;
                    const idempotent = request.params.arguments?.idempotent === true;
                    const broker = new github_broker_js_1.GitHubBroker(auth, repository);
                    const result = await broker.applyPlan(stagedPlan, dryRun, idempotent);
                    let responseText;
                    if (result.success) {
                        responseText = dryRun
                            ? `${result.message}\n\n${result.report}`
                            : `${result.message}\nMilestone URL: ${result.milestoneUrl}\n` +
                                `Created ${result.createdStories?.length || 0} stories and ${result.createdTasks?.length || 0} tasks.` +
                                (result.reusedStories?.length ? `\nReused ${result.reusedStories.length} existing stories.` : '') +
                                (result.reusedTasks?.length ? `\nReused ${result.reusedTasks.length} existing tasks.` : '');
                    }
                    else {
                        return {
                            content: [{ type: "text", text: `Failed to apply plan: ${result.message}\nDetails: ${result.error || ''}` }],
                            isError: true,
                        };
                    }
                    // If targetProject is set, also sync to GitHub Projects V2
                    if (result.success && stagedPlan.targetProject) {
                        const projectBroker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, stagedPlan.targetProject);
                        // Build issueNodeIdMap from created/reused issues for real linking
                        const issueNodeIdMap = {};
                        for (const s of [...(result.createdStories || []), ...(result.reusedStories || [])]) {
                            if (s.nodeId)
                                issueNodeIdMap[s.id] = s.nodeId;
                        }
                        for (const t of [...(result.createdTasks || []), ...(result.reusedTasks || [])]) {
                            if (t.nodeId)
                                issueNodeIdMap[t.id] = t.nodeId;
                        }
                        const projectResult = await projectBroker.applyPlanToProject(stagedPlan, {
                            createAsDraftIssues: Object.keys(issueNodeIdMap).length > 0 ? false : (stagedPlan.projectOptions?.createAsDraftIssues ?? true),
                            linkToMilestones: stagedPlan.projectOptions?.linkToMilestones ?? false,
                            dryRun: false,
                            idempotent,
                        }, Object.keys(issueNodeIdMap).length > 0 ? issueNodeIdMap : undefined);
                        responseText += `\n\n## GitHub Projects V2\n${projectResult.message}`;
                        if (!projectResult.success) {
                            responseText += `\nProject sync error: ${projectResult.error || ''}`;
                        }
                    }
                    return {
                        content: [{ type: "text", text: responseText }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "init_agile_harness") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const repository = this.resolveRepository(request.params.arguments);
                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument, GITHUB_REPOSITORY env var, or be inside a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }
                    const broker = new github_broker_js_1.GitHubBroker(auth, repository);
                    const result = await broker.initializeHarness();
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "fetch_existing_epics") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const repository = this.resolveRepository(request.params.arguments);
                    if (!repository) {
                        return {
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument, GITHUB_REPOSITORY env var, or be inside a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }
                    const broker = new github_broker_js_1.GitHubBroker(auth, repository);
                    const epics = await broker.fetchExistingEpics();
                    return {
                        content: [{ type: "text", text: JSON.stringify(epics, null, 2) }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "list_github_projects") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const ownerLogin = request.params.arguments?.ownerLogin || this.detectGitOwnerLogin() || '';
                    const isOrg = request.params.arguments?.isOrg === true;
                    if (!ownerLogin) {
                        return {
                            content: [{ type: "text", text: "Error: 'ownerLogin' is required. Provide it as argument or be inside a git repository with a GitHub remote." }],
                            isError: true,
                        };
                    }
                    const broker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, '');
                    const projects = await broker.listProjects(ownerLogin, isOrg);
                    if (projects.length === 0) {
                        return {
                            content: [{ type: "text", text: `No GitHub Projects V2 found for ${isOrg ? 'organization' : 'user'} '${ownerLogin}'.` }],
                        };
                    }
                    const text = projects.map((p) => `* **${p.title}** (#${p.number}) — ID: \`${p.id}\`${p.shortDescription ? ` — ${p.shortDescription}` : ''}${p.closed ? ' (closed)' : ''}`).join('\n');
                    return {
                        content: [{ type: "text", text: `## GitHub Projects V2 for '${ownerLogin}'\n\n${text}` }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "create_project") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const ownerLogin = request.params.arguments?.ownerLogin || this.detectGitOwnerLogin() || '';
                    const title = request.params.arguments?.title;
                    const isOrg = request.params.arguments?.isOrg === true;
                    if (!ownerLogin || !title) {
                        return {
                            content: [{ type: "text", text: `Error: 'title' is required.${!ownerLogin ? " 'ownerLogin' is required too — provide it or be inside a git repository with a GitHub remote." : ''}` }],
                            isError: true,
                        };
                    }
                    const broker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, '');
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
                    return {
                        content: [{ type: "text", text: `Project created successfully!\n\n* **${project.title}** (#${project.number}) — ID: \`${project.id}\`\n* URL: \`${project.url || `https://github.com/users/${ownerLogin}/projects/${project.number}`}\`` }],
                    };
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "get_project_fields") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const projectId = request.params.arguments?.projectId;
                    if (!projectId) {
                        return {
                            content: [{ type: "text", text: "Error: 'projectId' argument is required." }],
                            isError: true,
                        };
                    }
                    const broker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, projectId);
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
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "apply_plan_to_project") {
                const stagedPlan = await this.planner.getStagedPlan();
                if (!stagedPlan) {
                    return {
                        content: [{ type: "text", text: "Error: No staged agile plan found. Run 'stage_agile_plan' first." }],
                        isError: true,
                    };
                }
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const projectId = request.params.arguments?.projectId;
                    if (!projectId) {
                        return {
                            content: [{ type: "text", text: "Error: 'projectId' argument is required." }],
                            isError: true,
                        };
                    }
                    const createAsDraftIssues = request.params.arguments?.createAsDraftIssues !== false;
                    const dryRun = request.params.arguments?.dryRun !== false;
                    const idempotent = request.params.arguments?.idempotent === true;
                    const issueNodeIdMap = request.params.arguments?.issueNodeIdMap;
                    const broker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, projectId);
                    const result = await broker.applyPlanToProject(stagedPlan, {
                        createAsDraftIssues,
                        linkToMilestones: false,
                        dryRun,
                        idempotent,
                    }, issueNodeIdMap);
                    if (result.success) {
                        const responseText = dryRun
                            ? `${result.message}\n\n${result.report}`
                            : `${result.message}\n` +
                                `Created ${result.createdItems.length} items.` +
                                (result.reusedItems.length ? `\nReused ${result.reusedItems.length} existing items.` : '');
                        return {
                            content: [{ type: "text", text: responseText }],
                        };
                    }
                    else {
                        return {
                            content: [{ type: "text", text: `Failed to apply plan to project: ${result.message}\nDetails: ${result.error || ''}` }],
                            isError: true,
                        };
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    return {
                        content: [{ type: "text", text: `Error: ${message}` }],
                        isError: true,
                    };
                }
            }
            if (request.params.name === "sync_project_with_milestones") {
                try {
                    const auth = this.resolveAuth(request.params.arguments);
                    const projectId = request.params.arguments?.projectId;
                    if (!projectId) {
                        return {
                            content: [{ type: "text", text: "Error: 'projectId' argument is required." }],
                            isError: true,
                        };
                    }
                    const broker = new github_projects_broker_js_1.GitHubProjectsBroker(auth, projectId);
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
                }
                catch (error) {
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
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("@jackaranaram/agile-mcp-server running on stdio");
    }
}
const server = new AgileHarnessServer();
server.run().catch(console.error);
