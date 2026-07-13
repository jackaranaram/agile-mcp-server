import { GitHubBroker } from './github_broker';
import { AgilePlan, AuthConfig } from './types';

const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockGet = jest.fn();

jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: mockPost,
    patch: mockPatch,
    get: mockGet,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  })),
  post: jest.fn(),
}));

jest.mock('axios-retry', () => jest.fn());

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mocked-app-jwt'),
}));

describe('GitHubBroker', () => {
  const repository = 'test-owner/test-repo';

  const patAuth: AuthConfig = { type: 'pat', token: 'ghp_testtoken12345' };
  const appAuth: AuthConfig = { type: 'app', appId: '123', privateKey: 'pem-key', installationId: '456' };

  const mockPlan: AgilePlan = {
    version: '1.0',
    epic: {
      id: 'EPIC-1',
      title: 'Auth Integration',
      description: 'Setup authentication.',
      priority: 'HIGH',
      risk_level: 'MEDIUM',
      tags: ['security'],
      stories: [
        {
          id: 'STORY-1',
          title: 'Implement Login',
          description: 'As a user I want to log in.',
          acceptance_criteria: ['Login succeeds with valid credentials'],
          priority: 'HIGH',
          risk_level: 'LOW',
          tags: ['frontend'],
          tasks: [
            {
              id: 'TSK-1',
              title: 'Create POST /login',
              description: 'Backend login API.',
              target_files: ['src/api/login.ts'],
              priority: 'HIGH',
              tags: ['backend'],
            }
          ]
        }
      ]
    }
  };

  let broker: GitHubBroker;

  function mockPostOk(url: string, data: Record<string, unknown>) {
    if (url.endsWith('/labels')) {
      return Promise.resolve({ data: { name: data.name } });
    }
    if (url.endsWith('/milestones')) {
      return Promise.resolve({ data: { number: 42 } });
    }
    if (url.endsWith('/issues')) {
      if ((data.title as string).includes('STORY-1')) {
        return Promise.resolve({ data: { number: 101, html_url: 'https://github.com/story-1' } });
      }
      if ((data.title as string).includes('TSK-1')) {
        return Promise.resolve({ data: { number: 201, html_url: 'https://github.com/task-1' } });
      }
    }
    return Promise.reject(new Error(`Unexpected mock post url: ${url}`));
  }

  beforeEach(() => {
    broker = new GitHubBroker(patAuth, repository);
    jest.clearAllMocks();
  });

  describe('Constructor validation', () => {
    it('should throw error for invalid repository format', () => {
      expect(() => new GitHubBroker(patAuth, 'invalid-repo')).toThrow(
        'Invalid repository format: "invalid-repo". Expected "owner/repo".'
      );
    });

    it('should accept PAT auth without error', () => {
      expect(() => new GitHubBroker(patAuth, repository)).not.toThrow();
    });

    it('should accept GitHub App auth without error', () => {
      expect(() => new GitHubBroker(appAuth, repository)).not.toThrow();
    });
  });

  describe('Dry Run Mode', () => {
    it('should return a detailed markdown report and not call the API', async () => {
      const result = await broker.applyPlan(mockPlan, true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Simulation completed successfully');
      expect(result.report).toBeDefined();
      expect(result.report).toContain('Simulation Report (Dry Run)');
      expect(result.report).toContain('[EPIC-1] Auth Integration');
      expect(result.report).toContain('[STORY-1] Implement Login');

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('should include target milestone info in dry run when targetMilestone is set', async () => {
      const planWithTarget = { ...mockPlan, targetMilestone: 42 };
      const result = await broker.applyPlan(planWithTarget, true);

      expect(result.report).toContain('#42');
      expect(result.report).toContain('no new milestone will be created');
    });
  });

  describe('Execute Mode', () => {
    it('should successfully call API to create milestone, issues, and update body', async () => {
      mockPost.mockImplementation(mockPostOk);
      mockPatch.mockResolvedValue({ data: {} });

      const result = await broker.applyPlan(mockPlan, false);

      expect(result.success).toBe(true);
      expect(result.milestoneUrl).toContain('/milestone/42');
      expect(result.createdStories).toEqual([{ id: 'STORY-1', number: 101, url: 'https://github.com/story-1' }]);
      expect(result.createdTasks).toEqual([{ id: 'TSK-1', number: 201, url: 'https://github.com/task-1' }]);
      expect(result.reusedStories).toBeUndefined();
      expect(result.reusedTasks).toBeUndefined();

      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/milestones'), {
        title: '[EPIC-1] Auth Integration',
        description: 'Setup authentication.'
      });

      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/issues'), expect.objectContaining({
        title: '[STORY-1] Implement Login',
        milestone: 42
      }));

      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/issues'), expect.objectContaining({
        title: '[TSK-1] Create POST /login',
        milestone: 42
      }));

      expect(mockPatch).not.toHaveBeenCalled();
    });

    it('should use targetMilestone when provided instead of creating one', async () => {
      const planWithTarget = { ...mockPlan, targetMilestone: 99 };
      mockPost.mockImplementation(mockPostOk);
      mockPatch.mockResolvedValue({ data: {} });

      const result = await broker.applyPlan(planWithTarget, false);

      expect(result.success).toBe(true);
      expect(result.milestoneUrl).toContain('/milestone/99');

      const milestoneCalls = mockPost.mock.calls.filter((c: unknown[]) => (c[0] as string).endsWith('/milestones'));
      expect(milestoneCalls.length).toBe(0);
    });

    it('should return error status when GitHub API fails', async () => {
      mockPost.mockRejectedValue({
        response: {
          status: 401,
          data: { message: 'Bad credentials' }
        }
      });

      const result = await broker.applyPlan(mockPlan, false);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error applying plan');
      expect(result.error).toContain('Bad credentials');
    });
  });

  describe('Idempotent Mode', () => {
    it('should reuse existing milestone when found by title', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/milestones')) {
          return Promise.resolve({
            data: [
              { number: 42, title: '[EPIC-1] Auth Integration', description: 'Setup authentication.', state: 'open', html_url: 'https://github.com/test-owner/test-repo/milestone/42' }
            ]
          });
        }
        if (url.includes('/issues')) {
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      mockPost.mockImplementation(mockPostOk);
      mockPatch.mockResolvedValue({ data: {} });

      const result = await broker.applyPlan(mockPlan, false, true);

      expect(result.success).toBe(true);
      expect(result.milestoneUrl).toContain('/milestone/42');

      const milestonePosts = mockPost.mock.calls.filter((c: unknown[]) => (c[0] as string).endsWith('/milestones'));
      expect(milestonePosts.length).toBe(0);
    });

    it('should reuse existing stories and tasks when found by title', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url.includes('/milestones')) {
          return Promise.resolve({ data: [] });
        }
        if (url.includes('/issues')) {
          return Promise.resolve({
            data: [
              { number: 101, title: '[STORY-1] Implement Login', body: '', labels: [{ name: 'type:story' }], state: 'open', html_url: 'https://github.com/story-1' },
              { number: 201, title: '[TSK-1] Create POST /login', body: '', labels: [{ name: 'type:task' }], state: 'open', html_url: 'https://github.com/task-1' }
            ]
          });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      mockPost.mockImplementation((url: string, data: Record<string, unknown>) => {
        if (url.endsWith('/labels')) {
          return Promise.resolve({ data: { name: data.name } });
        }
        if (url.endsWith('/milestones')) {
          return Promise.resolve({ data: { number: 42 } });
        }
        return Promise.reject(new Error(`Unexpected mock post url: ${url}`));
      });

      const result = await broker.applyPlan(mockPlan, false, true);

      expect(result.success).toBe(true);
      expect(result.createdStories?.length).toBe(0);
      expect(result.createdTasks?.length).toBe(0);
      expect(result.reusedStories).toEqual([{ id: 'STORY-1', number: 101, url: 'https://github.com/story-1' }]);
      expect(result.reusedTasks).toEqual([{ id: 'TSK-1', number: 201, url: 'https://github.com/task-1' }]);
    });
  });

  describe('fetchExistingEpics', () => {
    it('should return formatted epics with their stories', async () => {
      mockGet.mockImplementation((url: string, config: { params?: Record<string, string> }) => {
        if (url.includes('/milestones')) {
          return Promise.resolve({
            data: [
              { number: 1, title: '[EPIC-1] Auth', description: 'Auth epic', state: 'open', html_url: 'https://github.com/milestones/1' },
              { number: 2, title: '[EPIC-2] UI', description: 'UI epic', state: 'open', html_url: 'https://github.com/milestones/2' },
            ]
          });
        }
        if (url.includes('/issues')) {
          const milestone = config?.params?.milestone;
          if (milestone === '1') {
            return Promise.resolve({
              data: [
                { number: 10, title: '[STORY-1] Login', body: '', labels: [{ name: 'type:story' }], state: 'open', html_url: 'https://github.com/10' },
                { number: 11, title: '[TS-1] API', body: '', labels: [{ name: 'type:task' }], state: 'open', html_url: 'https://github.com/11' },
              ]
            });
          }
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      const epics = await broker.fetchExistingEpics();

      expect(epics).toHaveLength(2);
      expect(epics[0].title).toBe('[EPIC-1] Auth');
      expect(epics[0].stories).toHaveLength(1);
      expect(epics[0].stories[0].title).toBe('[STORY-1] Login');
      expect(epics[1].stories).toHaveLength(0);
    });
  });

  describe('initializeHarness', () => {
    it('should return uninitialized state when repo has no milestones', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/repos/test-owner/test-repo') {
          return Promise.resolve({ status: 200, data: {} });
        }
        if (url.includes('/milestones')) {
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      const result = await broker.initializeHarness();

      expect(result.success).toBe(true);
      expect(result.isInitialized).toBe(false);
      expect(result.milestonesCount).toBe(0);
      expect(result.labelsCreated).toEqual([]);
      expect(result.repoExists).toBe(true);
      expect(result.authValid).toBe(true);
    });

    it('should return initialized state when repo has milestones', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/repos/test-owner/test-repo') {
          return Promise.resolve({ status: 200, data: {} });
        }
        if (url.includes('/milestones')) {
          return Promise.resolve({ data: [{ number: 1, title: 'Sprint 1' }] });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      const result = await broker.initializeHarness();

      expect(result.success).toBe(true);
      expect(result.isInitialized).toBe(true);
      expect(result.milestonesCount).toBe(1);
      expect(result.labelsCreated).toEqual([]);
    });

    it('should handle repo not found (404)', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/repos/test-owner/test-repo') {
          return Promise.reject({ response: { status: 404, data: { message: 'Not Found' } } });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      const result = await broker.initializeHarness();

      expect(result.success).toBe(false);
      expect(result.isInitialized).toBe(false);
      expect(result.repoExists).toBe(false);
    });

    it('should handle auth failure (401)', async () => {
      mockGet.mockImplementation((url: string) => {
        if (url === '/repos/test-owner/test-repo') {
          return Promise.reject({ response: { status: 401, data: { message: 'Bad credentials' } } });
        }
        return Promise.reject(new Error(`Unexpected get url: ${url}`));
      });

      const result = await broker.initializeHarness();

      expect(result.success).toBe(false);
      expect(result.authValid).toBe(false);
    });

  });

  describe('GitHub App Authentication', () => {
    // Integration-level testing is needed to verify the full App auth flow
    // (JWT generation, installation token fetch, auto-refresh).
    // Unit tests here verify the constructor accepts the config.
  });
});
