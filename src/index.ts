#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { AgilePlanner } from "./core/agile_planner.js";
import { GitHubBroker } from "./core/github_broker.js";
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

    private resolveRepository(args: Record<string, unknown> | undefined): string {
        return (args?.repository as string) || process.env.GITHUB_REPOSITORY || '';
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
                } as Tool,
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
                                description: "Target repository in 'owner/repo' format (defaults to GITHUB_REPOSITORY env var)"
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
                                description: "Target repository in 'owner/repo' format (defaults to GITHUB_REPOSITORY env var)"
                            }
                        }
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
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument or GITHUB_REPOSITORY environment variable." }],
                            isError: true,
                        };
                    }

                    const dryRun = request.params.arguments?.dryRun !== false;
                    const idempotent = request.params.arguments?.idempotent === true;

                    const broker = new GitHubBroker(auth, repository);
                    const result = await broker.applyPlan(stagedPlan, dryRun, idempotent);

                    if (result.success) {
                        const responseText = dryRun
                            ? `${result.message}\n\n${result.report}`
                            : `${result.message}\nMilestone URL: ${result.milestoneUrl}\n` +
                              `Created ${result.createdStories?.length || 0} stories and ${result.createdTasks?.length || 0} tasks.` +
                              (result.reusedStories?.length ? `\nReused ${result.reusedStories.length} existing stories.` : '') +
                              (result.reusedTasks?.length ? `\nReused ${result.reusedTasks.length} existing tasks.` : '');

                        return {
                            content: [{ type: "text", text: responseText }],
                        };
                    } else {
                        return {
                            content: [{ type: "text", text: `Failed to apply plan: ${result.message}\nDetails: ${result.error || ''}` }],
                            isError: true,
                        };
                    }
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
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument or GITHUB_REPOSITORY environment variable." }],
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
                            content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument or GITHUB_REPOSITORY environment variable." }],
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
