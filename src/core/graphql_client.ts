import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import jwt from 'jsonwebtoken';
import { AuthConfig } from './types';

export interface GraphQLResponse<T = unknown> {
  data: T;
  errors?: Array<{ message: string; locations?: unknown[]; path?: string[] }>;
}

export interface GraphQLRequestOptions {
  variables?: Record<string, unknown>;
}

export class GraphQLClient {
  private readonly client: AxiosInstance;
  private currentToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(
    private readonly auth: AuthConfig,
    private readonly baseUrl: string = 'https://api.github.com/graphql',
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        'X-Github-Next-Global-ID': '1',
      },
    });

    this.setupInterceptor();
    this.setupRateLimiting();
  }

  private setupInterceptor(): void {
    this.client.interceptors.request.use(async (config) => {
      const token = await this.resolveToken();
      config.headers.Authorization =
        this.auth.type === 'pat' ? `bearer ${token}` : `bearer ${token}`;
      return config;
    });
  }

  private setupRateLimiting(): void {
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        return status === 429 || status === 500 || status === 502 || status === 503;
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        const remaining = response.headers?.['x-ratelimit-remaining'];
        if (remaining !== undefined && parseInt(remaining) < 10) {
          const resetTime = parseInt(response.headers['x-ratelimit-reset'] || '0');
          const waitMs = Math.max(0, resetTime * 1000 - Date.now() + 1000);
          if (waitMs > 0) {
            return new Promise((resolve) => setTimeout(() => resolve(response), waitMs));
          }
        }
        return response;
      },
      (error) => Promise.reject(error),
    );
  }

  private async resolveToken(): Promise<string> {
    if (this.auth.type === 'pat') {
      return this.auth.token;
    }

    if (
      this.currentToken &&
      this.tokenExpiresAt &&
      Date.now() < this.tokenExpiresAt.getTime() - 60000
    ) {
      return this.currentToken;
    }

    const appJwt = this.generateAppJwt(this.auth.appId, this.auth.privateKey);
    this.currentToken = await this.fetchInstallationToken(appJwt, this.auth.installationId);
    this.tokenExpiresAt = new Date(Date.now() + 3600000);
    return this.currentToken;
  }

  private generateAppJwt(appId: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = { iat: now - 60, exp: now + 600, iss: appId };
    return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
  }

  private async fetchInstallationToken(jwtToken: string, installationId: string): Promise<string> {
    const response = await axios.post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {},
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      },
    );
    return response.data.token as string;
  }

  async query<T = unknown>(queryString: string, options?: GraphQLRequestOptions): Promise<T> {
    const response = await this.client.post<GraphQLResponse<T>>('', {
      query: queryString,
      variables: options?.variables || {},
    });

    const body = response.data;

    if (body.errors && body.errors.length > 0) {
      const messages = body.errors.map((e) => e.message).join('; ');
      throw new Error(`GraphQL errors: ${messages}`);
    }

    return body.data;
  }
}
