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
