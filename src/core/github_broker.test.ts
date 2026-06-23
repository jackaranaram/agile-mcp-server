import axios from 'axios';
import { GitHubBroker } from './github_broker';
import { AgilePlan } from './types';

jest.mock('axios');

const mockPost = jest.fn();
const mockPatch = jest.fn();

(axios.create as jest.Mock).mockReturnValue({
  post: mockPost,
  patch: mockPatch,
});

describe('GitHubBroker', () => {
  const repository = 'test-owner/test-repo';
  const token = 'ghp_testtoken12345';
  let broker: GitHubBroker;

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

  beforeEach(() => {
    broker = new GitHubBroker(token, repository);
    jest.clearAllMocks();
  });

  describe('Constructor validation', () => {
    it('should throw error for invalid repository format', () => {
      expect(() => new GitHubBroker(token, 'invalid-repo')).toThrow(
        'Invalid repository format: "invalid-repo". Expected "owner/repo".'
      );
    });
  });

  describe('Dry Run Mode', () => {
    it('should return a detailed markdown report and not call the API', async () => {
      const result = await broker.applyPlan(mockPlan, true);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Simulación completada con éxito');
      expect(result.report).toBeDefined();
      expect(result.report).toContain('Reporte de Simulación (Dry Run)');
      expect(result.report).toContain('[EPIC-1] Auth Integration');
      expect(result.report).toContain('[STORY-1] Implement Login');
      expect(result.report).toContain('[TSK-1] Create POST /login');

      expect(mockPost).not.toHaveBeenCalled();
      expect(mockPatch).not.toHaveBeenCalled();
    });
  });

  describe('Execute Mode', () => {
    it('should successfully call API to create milestone, issues, labels and update body', async () => {
      // Setup mock responses
      // 1. Labels
      mockPost.mockImplementation((url, data) => {
        if (url.endsWith('/labels')) {
          return Promise.resolve({ data: { name: data.name } });
        }
        if (url.endsWith('/milestones')) {
          return Promise.resolve({ data: { number: 42 } });
        }
        if (url.endsWith('/issues')) {
          if (data.title.includes('STORY-1')) {
            return Promise.resolve({ data: { number: 101, html_url: 'https://github.com/story-1' } });
          }
          if (data.title.includes('TSK-1')) {
            return Promise.resolve({ data: { number: 201, html_url: 'https://github.com/task-1' } });
          }
        }
        return Promise.reject(new Error(`Unexpected mock post url: ${url}`));
      });

      mockPatch.mockResolvedValue({ data: {} });

      const result = await broker.applyPlan(mockPlan, false);

      expect(result.success).toBe(true);
      expect(result.milestoneUrl).toContain('/milestone/42');
      expect(result.createdStories).toEqual([{ id: 'STORY-1', number: 101, url: 'https://github.com/story-1' }]);
      expect(result.createdTasks).toEqual([{ id: 'TSK-1', number: 201, url: 'https://github.com/task-1' }]);

      // Verify label creation (should attempt to create all collected labels)
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/labels'), expect.objectContaining({ name: 'type:epic' }));
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/labels'), expect.objectContaining({ name: 'priority:HIGH' }));
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/labels'), expect.objectContaining({ name: 'security' }));

      // Verify milestone creation
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/milestones'), {
        title: '[EPIC-1] Auth Integration',
        description: 'Setup authentication.'
      });

      // Verify Story issue creation
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/issues'), expect.objectContaining({
        title: '[STORY-1] Implement Login',
        milestone: 42,
        labels: expect.arrayContaining(['type:story', 'priority:HIGH', 'risk:LOW', 'frontend'])
      }));

      // Verify Task issue creation
      expect(mockPost).toHaveBeenCalledWith(expect.stringContaining('/issues'), expect.objectContaining({
        title: '[TSK-1] Create POST /login',
        milestone: 42,
        labels: expect.arrayContaining(['type:task', 'priority:HIGH', 'backend'])
      }));

      // Verify Story body update with reference to Task
      expect(mockPatch).toHaveBeenCalledWith(expect.stringContaining('/issues/101'), expect.objectContaining({
        body: expect.stringContaining('- [ ] #201 [TSK-1] Create POST /login')
      }));
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
      expect(result.message).toContain('Error al aplicar el plan en GitHub');
      expect(result.error).toContain('Bad credentials');
    });
  });
});
