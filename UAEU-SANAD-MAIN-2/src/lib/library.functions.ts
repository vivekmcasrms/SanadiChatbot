import { apiFetch } from "@/lib/auth-token";

export type LibraryIntegration = {
  providerName: string;
  baseUrl: string | null;
  authMethod: "header_api_key" | "query_api_key" | "bearer" | "basic_client_credentials" | "client_id_secret_headers";
  authHeaderName: string | null;
  authQueryParam: string | null;
  apiKeySecretName: string | null;
  searchPath: string | null;
  itemPath: string | null;
  catalogueUrlTemplate: string | null;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
  healthStatus: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastLatencyMs: number | null;
};

export type LibraryIntegrationInput = Pick<LibraryIntegration,
  "providerName" | "baseUrl" | "authMethod" | "authHeaderName" | "authQueryParam" |
  "searchPath" | "itemPath" | "catalogueUrlTemplate" | "timeoutMs" | "maxRetries" | "enabled">;

export const getLibraryIntegration = () => apiFetch<LibraryIntegration | null>("/api/library/integration");

export const updateLibraryIntegration = ({ data }: { data: LibraryIntegrationInput }) =>
  apiFetch<{ saved: boolean }>("/api/library/integration", { method: "PUT", body: JSON.stringify(data) });

export const testLibraryConnection = (_input: Record<string, never> = {}) =>
  apiFetch<{ ok: boolean; sampleCount: number; latencyMs: number; error: string | null }>("/api/library/integration/test", { method: "POST" });

export type OclcDiagnostics = {
  institutionId: string | null;
  scopes: string | null;
  tokenCached: boolean;
  tokenExpiresAt: string | null;
  services: Array<{ key: string; label: string; status: "healthy" | "failed" | "not_configured"; detail: string | null }>;
  health: Array<{ service: string; calls: number; failures: number; avgLatencyMs: number | null; rateLimitEvents: number }>;
};

export const getOclcDiagnostics = (_input: Record<string, never> = {}) =>
  apiFetch<OclcDiagnostics>("/api/library/oclc/diagnostics");

export type OclcTestSearch = {
  status: string;
  latencyMs: number;
  resultsReturned: number;
  localHoldings: number;
  availabilityResolved: number;
  electronicAccess: number;
  error: string | null;
  sample: Array<{ title: string; year: number | null; type: string; scope: string }>;
};

export const runOclcTestSearch = ({ data }: { data: { query: string } }) =>
  apiFetch<OclcTestSearch>("/api/library/oclc/test-search", { method: "POST", body: JSON.stringify(data) });
