import { GitHubProjectsBroker } from './github_projects_broker';
import { GraphQLClient } from './graphql_client';
import { AgilePlan, ProjectInfo, ProjectField } from './types';

jest.mock('./graphql_client');

const MockedGraphQLClient = GraphQLClient as jest.MockedClass<typeof GraphQLClient>;

function makePlan(overrides?: Partial<AgilePlan>): AgilePlan {
  return {
    version: '1.0',
    targetProject: 'project-node-id-123',
    epic: {
      id: 'EPIC-1',
      title: 'Test Epic',
      description: 'An epic for testing',
      priority: 'HIGH',
      risk_level: 'MEDIUM',
      tags: [],
      stories: [
        {
          id: 'STORY-1',
          title: 'First Story',
          description: 'As a user, I want to test',
          acceptance_criteria: ['It works'],
          priority: 'HIGH',
          risk_level: 'LOW',
          tags: [],
          tasks: [
            {
              id: 'TS-1',
              title: 'Implement test',
              description: 'Write the test code',
              target_files: ['test.ts'],
              story_points: 3,
              priority: 'MEDIUM',
              tags: [],
            },
          ],
        },
      ],
      ...overrides?.epic,
    },
    ...overrides,
  } as AgilePlan;
}

const mockFields: ProjectField[] = [
  {
    id: 'field-type-id',
    name: 'Type',
    dataType: 'SINGLE_SELECT',
    options: [
      { id: 'opt-story', name: 'Story' },
      { id: 'opt-task', name: 'Task' },
      { id: 'opt-epic', name: 'Epic' },
    ],
  },
  {
    id: 'field-priority-id',
    name: 'Priority',
    dataType: 'SINGLE_SELECT',
    options: [
      { id: 'opt-low', name: 'LOW' },
      { id: 'opt-medium', name: 'MEDIUM' },
      { id: 'opt-high', name: 'HIGH' },
      { id: 'opt-critical', name: 'CRITICAL' },
    ],
  },
  {
    id: 'field-risk-id',
    name: 'Risk',
    dataType: 'SINGLE_SELECT',
    options: [
      { id: 'opt-risk-low', name: 'LOW' },
      { id: 'opt-risk-medium', name: 'MEDIUM' },
      { id: 'opt-risk-high', name: 'HIGH' },
    ],
  },
  {
    id: 'field-sp-id',
    name: 'Story Points',
    dataType: 'NUMBER',
  },
];

let broker: GitHubProjectsBroker;

beforeEach(() => {
  jest.clearAllMocks();
  MockedGraphQLClient.prototype.query.mockResolvedValue({});
  broker = new GitHubProjectsBroker(
    { type: 'pat', token: 'ghp_test' },
    'project-node-id-123',
  );
});

describe('GitHubProjectsBroker', () => {
  describe('listProjects', () => {
    it('returns user projects', async () => {
      const fakeProjects: ProjectInfo[] = [
        { id: 'p1', title: 'My Project', number: 1, shortDescription: 'Test', closed: false },
      ];
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        user: { projectsV2: { nodes: fakeProjects } },
        organization: null,
      });

      const result = await broker.listProjects('testuser');
      expect(result).toEqual(fakeProjects);
    });

    it('returns org projects when isOrg=true', async () => {
      const fakeProjects: ProjectInfo[] = [
        { id: 'p2', title: 'Org Project', number: 2, shortDescription: '', closed: false },
      ];
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        user: null,
        organization: { projectsV2: { nodes: fakeProjects } },
      });

      const result = await broker.listProjects('myorg', true);
      expect(result).toEqual(fakeProjects);
    });

    it('returns empty array when no projects', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        user: { projectsV2: { nodes: [] } },
        organization: null,
      });

      const result = await broker.listProjects('testuser');
      expect(result).toEqual([]);
    });
  });

  describe('getProjectFields', () => {
    it('returns fields for a project', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        node: {
          title: 'Test Project',
          number: 1,
          fields: { nodes: mockFields.map((f) => ({ ...f, options: f.options ?? [] })) },
        },
      });

      const result = await broker.getProjectFields();
      expect(result).toHaveLength(4);
      expect(result[0].name).toBe('Type');
    });

    it('throws when project not found', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({ node: null });

      await expect(broker.getProjectFields()).rejects.toThrow('Project not found');
    });
  });

  describe('getProjectItems', () => {
    it('returns items with field values', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        node: {
          title: 'Test',
          items: {
            pageInfo: { hasNextPage: false, endCursor: '' },
            nodes: [
              {
                id: 'item-1',
                type: 'ISSUE',
                content: { id: 'issue-1', title: 'Test Issue', number: 42, url: 'https://github.com/test' },
                fieldValues: {
                  nodes: [
                    { name: 'HIGH', field: { name: 'Priority', id: 'f1' } },
                  ],
                },
              },
            ],
          },
        },
      });

      const result = await broker.getProjectItems();
      expect(result).toHaveLength(1);
      expect(result[0].fieldValues.Priority).toBe('HIGH');
    });

    it('paginates through items', async () => {
      MockedGraphQLClient.prototype.query
        .mockResolvedValueOnce({
          node: {
            title: 'Test',
            items: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
              nodes: [
                { id: 'item-1', type: 'ISSUE', content: { id: 'i1', title: 'Item 1' }, fieldValues: { nodes: [] } },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          node: {
            title: 'Test',
            items: {
              pageInfo: { hasNextPage: false, endCursor: '' },
              nodes: [
                { id: 'item-2', type: 'ISSUE', content: { id: 'i2', title: 'Item 2' }, fieldValues: { nodes: [] } },
              ],
            },
          },
        });

      const result = await broker.getProjectItems();
      expect(result).toHaveLength(2);
      expect(MockedGraphQLClient.prototype.query).toHaveBeenCalledTimes(2);
    });

    it('throws when project not found', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({ node: null });

      await expect(broker.getProjectItems()).rejects.toThrow('Project not found');
    });
  });

  describe('addIssueToProject', () => {
    it('adds existing issue to project and returns item ID', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        addProjectV2ItemById: { item: { id: 'added-item-id' } },
      });

      const result = await broker.addIssueToProject('issue-node-id');
      expect(result).toBe('added-item-id');
    });
  });

  describe('updateItemFieldSingleSelect', () => {
    it('updates a single select field', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-1' } },
      });

      await expect(
        broker.updateItemFieldSingleSelect('item-1', 'field-1', 'option-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('updateItemFieldNumber', () => {
    it('updates a number field', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: 'item-1' } },
      });

      await expect(
        broker.updateItemFieldNumber('item-1', 'field-1', 5),
      ).resolves.toBeUndefined();
    });
  });

  describe('getRepositoryNodeId', () => {
    it('returns repository node ID', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
        repository: { id: 'repo-node-id' },
      });

      const result = await broker.getRepositoryNodeId('owner', 'repo');
      expect(result).toBe('repo-node-id');
    });

    it('throws when repository not found', async () => {
      MockedGraphQLClient.prototype.query.mockResolvedValueOnce({ repository: null });

      await expect(broker.getRepositoryNodeId('owner', 'repo')).rejects.toThrow('Repository not found');
    });
  });

  describe('applyPlanToProject', () => {
    describe('dry run', () => {
      it('generates report without creating items', async () => {
        const plan = makePlan();
        const result = await broker.applyPlanToProject(plan, {
          linkToMilestones: false,
          dryRun: true,
          idempotent: false,
        });

        expect(result.success).toBe(true);
        expect(result.createdItems).toHaveLength(0);
        expect(result.report).toContain('STORY-1');
        expect(result.report).toContain('TS-1');
        expect(MockedGraphQLClient.prototype.query).not.toHaveBeenCalled();
      });
    });

    describe('execute with real issues', () => {
      it('adds existing issues to project and sets fields', async () => {
        const plan = makePlan();

        // Mock getProjectFields
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          node: {
            title: 'Test',
            number: 1,
            fields: { nodes: mockFields.map((f) => ({ ...f, options: f.options ?? [] })) },
          },
        });

        // Mock addIssueToProject for story
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          addProjectV2ItemById: { item: { id: 'story-item-id' } },
        });

        // Mock updateType for story
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          updateProjectV2ItemFieldValue: { projectV2Item: { id: 'story-item-id' } },
        });

        // Mock addIssueToProject for task
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          addProjectV2ItemById: { item: { id: 'task-item-id' } },
        });
        // Mock updateType for task
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          updateProjectV2ItemFieldValue: { projectV2Item: { id: 'task-item-id' } },
        });

        const result = await broker.applyPlanToProject(plan, {
          linkToMilestones: false,
          dryRun: false,
          idempotent: false,
        }, { 'STORY-1': 'story-node-id', 'TS-1': 'task-node-id' });

        expect(result.success).toBe(true);
        expect(result.createdItems).toHaveLength(2);
        expect(result.createdItems[0].title).toBe('[STORY-1] First Story');
        expect(result.createdItems[1].title).toBe('[TS-1] Implement test');
        expect(result.message).toContain('Created 2 items');
      });
    });

    describe('idempotent mode', () => {
      it('reuses existing items by title', async () => {
        const plan = makePlan();

        // Mock getProjectFields
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          node: {
            title: 'Test',
            number: 1,
            fields: { nodes: mockFields.map((f) => ({ ...f, options: f.options ?? [] })) },
          },
        });

        // Mock getProjectItems (returns existing items)
        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          node: {
            title: 'Test',
            items: {
              pageInfo: { hasNextPage: false, endCursor: '' },
              nodes: [
                {
                  id: 'existing-story',
                  type: 'ISSUE',
                  content: { id: 'i1', title: '[STORY-1] First Story' },
                  fieldValues: { nodes: [] },
                },
                {
                  id: 'existing-task',
                  type: 'ISSUE',
                  content: { id: 'i2', title: '[TS-1] Implement test' },
                  fieldValues: { nodes: [] },
                },
              ],
            },
          },
        });

        const result = await broker.applyPlanToProject(plan, {
          linkToMilestones: false,
          dryRun: false,
          idempotent: true,
        }, { 'STORY-1': 'story-node-id', 'TS-1': 'task-node-id' });

        expect(result.success).toBe(true);
        expect(result.createdItems).toHaveLength(0);
        expect(result.reusedItems).toHaveLength(2);
        expect(result.message).toContain('Reused 2 existing items');
      });
    });

    describe('error handling', () => {
      it('returns error when applying plan fails', async () => {
        const plan = makePlan();

        MockedGraphQLClient.prototype.query.mockImplementationOnce(async () => {
          throw new Error('API Error');
        });

        const result = await broker.applyPlanToProject(plan, {
          linkToMilestones: false,
          dryRun: false,
          idempotent: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('API Error');
      });

      it('throws when no node ID mapped', async () => {
        const plan = makePlan();

        MockedGraphQLClient.prototype.query.mockResolvedValueOnce({
          node: {
            title: 'Test',
            number: 1,
            fields: { nodes: mockFields.map((f) => ({ ...f, options: f.options ?? [] })) },
          },
        });

        const result = await broker.applyPlanToProject(plan, {
          linkToMilestones: false,
          dryRun: false,
          idempotent: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No node ID mapped for story STORY-1');
      });
    });
  });
});
