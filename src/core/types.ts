import { z } from 'zod';

export const PrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const TechnicalTaskSchema = z.object({
  id: z.string().describe("Unique identifier for the task, e.g., TSK-1"),
  title: z.string().describe("Short, actionable title"),
  description: z.string().describe("Detailed technical explanation of what needs to be done"),
  target_files: z.array(z.string()).describe("Specific files or modules to be modified"),
  story_points: z.number().optional().describe("Estimated effort in story points"),
  priority: PrioritySchema.default("MEDIUM"),
  tags: z.array(z.string()).default([]),
});

export const UserStorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().describe("As a [role], I want [feature] so that [benefit]"),
  acceptance_criteria: z.array(z.string()).describe("List of testable criteria"),
  priority: PrioritySchema.default("MEDIUM"),
  risk_level: RiskLevelSchema.default("LOW"),
  tags: z.array(z.string()).default([]),
  tasks: z.array(TechnicalTaskSchema)
});

export const EpicSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: PrioritySchema.default("MEDIUM"),
  risk_level: RiskLevelSchema.default("LOW"),
  tags: z.array(z.string()).default([]),
  stories: z.array(UserStorySchema)
});

export const AgilePlanSchema = z.object({
  version: z.string().default("1.0"),
  epic: EpicSchema,
  targetMilestone: z.number().optional().describe("If set, stories will be added to this existing milestone instead of creating a new one"),
  targetProject: z.string().optional().describe("Node ID of an existing GitHub Project V2 to sync items into"),
  projectOptions: z.object({
    createAsDraftIssues: z.boolean().default(true).describe("If true, creates draft issues directly in the project. If false, adds existing issues by node ID."),
    linkToMilestones: z.boolean().default(false).describe("If true, also creates milestones and issues (same as without targetProject) in addition to project items"),
  }).optional(),
});

export type AgilePlan = z.infer<typeof AgilePlanSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type UserStory = z.infer<typeof UserStorySchema>;
export type TechnicalTask = z.infer<typeof TechnicalTaskSchema>;

export interface GitHubMilestone {
  number: number;
  title: string;
  description: string;
  state: string;
  html_url: string;
}

export interface GitHubLabel {
  name: string;
  color: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
  state: string;
  html_url: string;
  node_id?: string;
  milestone?: { number: number; title: string };
}

export interface ExistingEpicInfo {
  number: number;
  title: string;
  description: string;
  state: string;
  htmlUrl: string;
  stories: Array<{
    number: number;
    title: string;
    state: string;
    htmlUrl: string;
  }>;
}

export type AuthConfig =
  | { type: 'pat'; token: string }
  | { type: 'app'; appId: string; privateKey: string; installationId: string };

export interface InitHarnessResult {
  success: boolean;
  message: string;
  isInitialized: boolean;
  milestonesCount: number;
  labelsCount: number;
  labelsCreated: string[];
  repoExists: boolean;
  authValid: boolean;
}

// ---------------------------------------------------------------------------
// GitHub Projects V2 Types
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  id: string;
  title: string;
  number: number;
  shortDescription?: string;
  closed: boolean;
  url?: string;
}

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface CustomSingleSelectOption {
  name: string;
  color: string;
  description?: string;
}


export interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: ProjectFieldOption[];
}

export interface ProjectItemContent {
  id: string;
  title: string;
  number?: number;
  url?: string;
}

export interface ProjectItem {
  id: string;
  type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE';
  content: ProjectItemContent | null;
  fieldValues: Record<string, string | number>;
}

export interface ApplyToProjectOptions {
  createAsDraftIssues: boolean;
  linkToMilestones: boolean;
  dryRun: boolean;
  idempotent: boolean;
}

export interface ApplyToProjectResult {
  success: boolean;
  message: string;
  projectUrl?: string;
  createdItems: Array<{ id: string; title: string }>;
  reusedItems: Array<{ id: string; title: string }>;
  report?: string;
  error?: string;
}
