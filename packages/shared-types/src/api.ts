// API request/response DTOs. Populated in Phase 1.

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthRegisterRequest {
  email: string;
  password: string;
  name: string;
  organizationName: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface ContactSessionCreateRequest {
  websiteDomain: string;
  agentSlug?: string;
  metadata?: Record<string, unknown>;
}

export interface ContactSessionCreateResponse {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
}
