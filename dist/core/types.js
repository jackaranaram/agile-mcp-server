"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgilePlanSchema = exports.EpicSchema = exports.UserStorySchema = exports.TechnicalTaskSchema = exports.RiskLevelSchema = exports.PrioritySchema = void 0;
const zod_1 = require("zod");
exports.PrioritySchema = zod_1.z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
exports.RiskLevelSchema = zod_1.z.enum(["LOW", "MEDIUM", "HIGH"]);
exports.TechnicalTaskSchema = zod_1.z.object({
    id: zod_1.z.string().describe("Unique identifier for the task, e.g., TSK-1"),
    title: zod_1.z.string().describe("Short, actionable title"),
    description: zod_1.z.string().describe("Detailed technical explanation of what needs to be done"),
    target_files: zod_1.z.array(zod_1.z.string()).describe("Specific files or modules to be modified"),
    story_points: zod_1.z.number().optional().describe("Estimated effort in story points"),
    priority: exports.PrioritySchema.default("MEDIUM"),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
});
exports.UserStorySchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string().describe("As a [role], I want [feature] so that [benefit]"),
    acceptance_criteria: zod_1.z.array(zod_1.z.string()).describe("List of testable criteria"),
    priority: exports.PrioritySchema.default("MEDIUM"),
    risk_level: exports.RiskLevelSchema.default("LOW"),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    tasks: zod_1.z.array(exports.TechnicalTaskSchema)
});
exports.EpicSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(),
    description: zod_1.z.string(),
    priority: exports.PrioritySchema.default("MEDIUM"),
    risk_level: exports.RiskLevelSchema.default("LOW"),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    stories: zod_1.z.array(exports.UserStorySchema)
});
exports.AgilePlanSchema = zod_1.z.object({
    version: zod_1.z.string().default("1.0"),
    epic: exports.EpicSchema,
    targetMilestone: zod_1.z.number().optional().describe("If set, stories will be added to this existing milestone instead of creating a new one"),
});
