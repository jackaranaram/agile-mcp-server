import { AgilePlanner } from './agile_planner';
import { promises as fs } from 'fs';
import path from 'path';

// Mock fs to prevent actual file writes during tests
jest.mock('fs', () => ({
    promises: {
        writeFile: jest.fn(),
        readFile: jest.fn(),
    }
}));

describe('AgilePlanner', () => {
    let planner: AgilePlanner;

    beforeEach(() => {
        planner = new AgilePlanner('/mock/workspace');
        jest.clearAllMocks();
    });

    it('should successfully validate and stage a valid payload', async () => {
        const validPayload = {
            version: "1.0",
            epic: {
                id: "EPIC-1",
                title: "Authentication System",
                description: "Implement core auth.",
                priority: "HIGH",
                risk_level: "MEDIUM",
                tags: ["security"],
                stories: [
                    {
                        id: "STORY-1",
                        title: "Login API",
                        description: "As a user, I want to login.",
                        acceptance_criteria: ["Returns JWT on success"],
                        priority: "HIGH",
                        risk_level: "LOW",
                        tags: ["backend"],
                        tasks: [
                            {
                                id: "TSK-1",
                                title: "Create login endpoint",
                                description: "Add POST /login",
                                target_files: ["src/routes/auth.ts"],
                                priority: "MEDIUM",
                                tags: []
                            }
                        ]
                    }
                ]
            }
        };

        const result = await planner.stagePlan(validPayload);
        
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.filePath).toBe(path.join('/mock/workspace', '.agile_plan.json'));
        }
        
        expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should reject a payload with missing required fields', async () => {
        const invalidPayload = {
            epic: {
                id: "EPIC-2",
                // Missing title, description
                stories: []
            }
        };

        const result = await planner.stagePlan(invalidPayload);
        
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.errors[0]).toContain('Required');
        }
        
        expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should reject a payload with invalid priority enum', async () => {
        const invalidPayload = {
            epic: {
                id: "EPIC-3",
                title: "Bad Enum",
                description: "Testing enum validation",
                priority: "SUPER_HIGH", // Invalid enum
                stories: []
            }
        };

        const result = await planner.stagePlan(invalidPayload);
        
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.errors.some(e => e.includes('Invalid enum value'))).toBe(true);
        }
    });
});
