import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool
} from "@modelcontextprotocol/sdk/types.js";
import { AgilePlanner } from "./core/agile_planner.js";
import { GitHubBroker } from "./core/github_broker.js";

/**
 * Agile Agent Harness - MCP Server Entrypoint
 */
class AgileHarnessServer {
    private server: Server;
    private planner: AgilePlanner;

    constructor() {
        this.server = new Server(
            {
                name: "agile-agent-harness",
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
                                description: "The full AgilePlan JSON payload matching the AgilePlanSchema."
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
                            repository: {
                                type: "string",
                                description: "Target repository in 'owner/repo' format (defaults to GITHUB_REPOSITORY environment variable)"
                            },
                            dryRun: {
                                type: "boolean",
                                description: "If true, simulates the changes and returns a markdown report. If false, creates them on GitHub. Defaults to true."
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

                const githubToken = (request.params.arguments?.githubToken as string) || process.env.GITHUB_TOKEN;
                const repository = (request.params.arguments?.repository as string) || process.env.GITHUB_REPOSITORY;
                const dryRun = request.params.arguments?.dryRun !== false; // defaults to true if not explicitly false

                if (!githubToken) {
                    return {
                        content: [{ type: "text", text: "Error: GitHub token is missing. Provide it via 'githubToken' argument or GITHUB_TOKEN environment variable." }],
                        isError: true,
                    };
                }

                if (!repository) {
                    return {
                        content: [{ type: "text", text: "Error: Repository is missing. Provide it via 'repository' argument or GITHUB_REPOSITORY environment variable." }],
                        isError: true,
                    };
                }

                try {
                    const broker = new GitHubBroker(githubToken, repository);
                    const result = await broker.applyPlan(stagedPlan, dryRun);
                    
                    if (result.success) {
                        const responseText = dryRun 
                            ? `${result.message}\n\n${result.report}`
                            : `${result.message}\nMilestone URL: ${result.milestoneUrl}\n` +
                              `Created ${result.createdStories?.length} stories and ${result.createdTasks?.length} tasks.`;

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
                        content: [{ type: "text", text: `Initialization error: ${message}` }],
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
        console.error("Agile Agent Harness MCP server running on stdio");
    }
}

const server = new AgileHarnessServer();
server.run().catch(console.error);
