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
  epic: EpicSchema
});

export type AgilePlan = z.infer<typeof AgilePlanSchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type UserStory = z.infer<typeof UserStorySchema>;
export type TechnicalTask = z.infer<typeof TechnicalTaskSchema>;
