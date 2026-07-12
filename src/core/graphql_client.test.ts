import axios from 'axios';
import jwt from 'jsonwebtoken';
import { GraphQLClient } from './graphql_client';

jest.mock('axios');
jest.mock('jsonwebtoken');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

const mockPost = jest.fn();
const mockInterceptors = {
  request: { use: jest.fn() },
  response: { use: jest.fn((_onFulfilled) => _onFulfilled) },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedAxios.create.mockReturnValue({
    post: mockPost,
    interceptors: mockInterceptors,
  } as unknown as ReturnType<typeof axios.create>);
  (mockedJwt.sign as unknown as jest.Mock).mockReturnValue('mock-jwt-token');
});

function makePatAuth() {
  return { type: 'pat' as const, token: 'ghp_test123' };
}

function makeAppAuth() {
  return { type: 'app' as const, appId: '123', privateKey: 'fake-key', installationId: '456' };
}

describe('GraphQLClient', () => {
  describe('constructor', () => {
    it('creates axios client with GraphQL endpoint and required headers', () => {
      new GraphQLClient(makePatAuth());
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://api.github.com/graphql',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Github-Next-Global-ID': '1',
          }),
        }),
      );
    });

    it('accepts custom base URL', () => {
      new GraphQLClient(makePatAuth(), 'https://github.internal/graphql');
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://github.internal/graphql' }),
      );
    });
  });

  describe('query', () => {
    it('sends query with variables and returns data', async () => {
      mockPost.mockResolvedValueOnce({
        data: { data: { viewer: { login: 'test-user' } } },
      });

      const client = new GraphQLClient(makePatAuth());
      const result = await client.query<{ viewer: { login: string } }>(
        'query { viewer { login } }',
        { variables: { first: 10 } },
      );

      expect(mockPost).toHaveBeenCalledWith('', {
        query: 'query { viewer { login } }',
        variables: { first: 10 },
      });
      expect(result).toEqual({ viewer: { login: 'test-user' } });
    });

    it('sends empty variables when none provided', async () => {
      mockPost.mockResolvedValueOnce({
        data: { data: { test: true } },
      });

      const client = new GraphQLClient(makePatAuth());
      await client.query('query { test }');

      expect(mockPost).toHaveBeenCalledWith('', {
        query: 'query { test }',
        variables: {},
      });
    });

    it('throws on GraphQL errors in response', async () => {
      mockPost.mockResolvedValueOnce({
        data: {
          data: null,
          errors: [{ message: 'Field not found' }, { message: 'Unauthorized' }],
        },
      });

      const client = new GraphQLClient(makePatAuth());
      await expect(client.query('bad query')).rejects.toThrow(
        'GraphQL errors: Field not found; Unauthorized',
      );
    });

    it('returns data when errors array is empty', async () => {
      mockPost.mockResolvedValueOnce({
        data: { data: { ok: true }, errors: [] },
      });

      const client = new GraphQLClient(makePatAuth());
      const result = await client.query<{ ok: boolean }>('query { ok }');
      expect(result).toEqual({ ok: true });
    });

    it('handles network errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const client = new GraphQLClient(makePatAuth());
      await expect(client.query('query { test }')).rejects.toThrow('ECONNREFUSED');
    });

    it('handles 401 auth errors', async () => {
      const error = new Error('Request failed') as import('axios').AxiosError;
      error.response = {
        status: 401,
        data: { message: 'Bad credentials' },
        statusText: 'Unauthorized',
        headers: {},
        config: {} as never,
      };
      mockPost.mockRejectedValueOnce(error);

      const client = new GraphQLClient(makePatAuth());
      await expect(client.query('query { test }')).rejects.toThrow('Request failed');
    });
  });

  describe('authentication', () => {
    it('uses PAT token for authorization header', async () => {
      let interceptorCallback: ((config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) | undefined;
      mockInterceptors.request.use.mockImplementation(
        (fn: (config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) => {
          if (!interceptorCallback) interceptorCallback = fn;
        },
      );

      mockPost.mockResolvedValueOnce({ data: { data: {} } });

      new GraphQLClient(makePatAuth());
      expect(interceptorCallback).toBeDefined();

      const config = await interceptorCallback!({ headers: {} } as import('axios').InternalAxiosRequestConfig);
      expect(config.headers.Authorization).toBe('bearer ghp_test123');
    });

    it('generates JWT and fetches installation token for App auth', async () => {
      const fakeInstallationToken = 'ghs_installation_token_123';
      let interceptorCallback: ((config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) | undefined;
      mockInterceptors.request.use.mockImplementation(
        (fn: (config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) => {
          if (!interceptorCallback) interceptorCallback = fn;
        },
      );

      mockedAxios.post.mockResolvedValueOnce({
        data: { token: fakeInstallationToken },
      });

      mockPost.mockResolvedValueOnce({ data: { data: {} } });

      new GraphQLClient(makeAppAuth());
      const config = await interceptorCallback!({ headers: {} } as import('axios').InternalAxiosRequestConfig);

      expect(mockedJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ iss: '123' }),
        'fake-key',
        { algorithm: 'RS256' },
      );
      expect(config.headers.Authorization).toBe(`bearer ${fakeInstallationToken}`);
    });

    it('caches App token and reuses on subsequent requests', async () => {
      const fakeInstallationToken = 'ghs_cached_token';
      let interceptorCallback: ((config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) | undefined;
      mockInterceptors.request.use.mockImplementation(
        (fn: (config: import('axios').InternalAxiosRequestConfig) => Promise<import('axios').InternalAxiosRequestConfig>) => {
          if (!interceptorCallback) interceptorCallback = fn;
        },
      );

      mockedAxios.post.mockResolvedValueOnce({
        data: { token: fakeInstallationToken },
      });

      new GraphQLClient(makeAppAuth());

      await interceptorCallback!({ headers: {} } as import('axios').InternalAxiosRequestConfig);
      await interceptorCallback!({ headers: {} } as import('axios').InternalAxiosRequestConfig);

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });
  });
});
