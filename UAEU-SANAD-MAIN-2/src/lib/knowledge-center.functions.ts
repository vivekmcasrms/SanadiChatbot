/** Knowledge & Integrations Center — thin C# API wrappers. */
import { apiFetch } from "@/lib/auth-token";

type Call<T> = { data: T };
type Any = Record<string, any>;

const get = <T>(path: string) => apiFetch<T>(`/api/knowledge/${path}`);
const post = <T>(path: string, data?: unknown) =>
  apiFetch<T>(`/api/knowledge/${path}`, { method: "POST", body: JSON.stringify(data ?? {}) });

/* ------------------------------------------------------------------ overview */

export const getCenterOverview = (_?: Call<never>) => get<Any>("overview");

/* ----------------------------------------------------------------- documents */

export const listDocuments = ({ data }: Call<{ search?: string; status?: string }>) =>
  post<Any>("documents/list", data ?? {});

export const uploadDocument = ({ data }: Call<Any>) => post<Any>("documents/upload", data);

export const requestDocumentApproval = ({ data }: Call<{ documentId: string }>) =>
  post<{ ok: boolean }>("documents/approval/request", data);

export const decideDocumentApproval = ({
  data,
}: Call<{ documentId: string; decision: string; notes?: string }>) =>
  post<{ ok: boolean }>("documents/approval/decide", data);

export const retireDocument = ({
  data,
}: Call<{ documentId: string; reason: string; replacementId?: string | null }>) =>
  post<{ ok: boolean }>("documents/retire", data);

export const rollbackDocumentVersion = ({
  data,
}: Call<{ currentId: string; previousId: string }>) =>
  post<{ ok: boolean }>("documents/rollback", data);

export const reprocessDocumentIndex = ({ data }: Call<{ documentId: string }>) =>
  post<Any>("documents/reprocess", data);

export const activateKnowledgeSource = ({
  data,
}: Call<{ documentId: string; lang?: string }>) => post<Any>("documents/activate", data);

export const diagnoseDocumentSearch = ({
  data,
}: Call<{ documentId: string; query: string }>) => post<Any>("documents/diagnose", data);

export const replaceDocument = ({ data }: Call<Any>) => post<Any>("documents/replace", data);

/* ---------------------------------------------------------------- web sources */

export const listWebSources = (_?: Call<never>) => get<Any>("web/sources");

export const listWebSourcePages = ({ data }: Call<{ id: string }>) =>
  post<{ pages: Any[] }>("web/pages", data);

export const saveWebSource = ({ data }: Call<Any>) => post<{ id: string }>("web/save", data);

export const refreshWebSource = ({ data }: Call<{ id: string; revisionSeed?: string }>) =>
  post<Any>("web/refresh", data);

export const reviewWebChange = ({ data }: Call<{ changeId: string; decision: string }>) =>
  post<{ ok: boolean }>("web/review-change", data);

/* ---------------------------------------------------------------- connectors */

export const listConnectors = (_?: Call<never>) => get<Any>("connectors");

export const updateConnector = ({ data }: Call<Any>) =>
  post<{ ok: boolean }>("connectors/update", data);

export const createConnector = ({ data }: Call<Any>) =>
  post<{ id: string }>("connectors/create", data);

export const updateTool = ({ data }: Call<Any>) =>
  post<{ ok: boolean }>("connectors/tools/update", data);

export const saveFieldMapping = ({ data }: Call<Any>) =>
  post<{ ok: boolean }>("connectors/mappings/save", data);

export const testConnector = ({ data }: Call<{ connectorId: string; toolName?: string }>) =>
  post<Any>("connectors/test", data);

export const previewConnectorTool = ({ data }: Call<{ toolName: string }>) =>
  post<Any>("connectors/preview", data);

/* ------------------------------------------------------------ knowledge health */

export const getKnowledgeHealth = (_?: Call<never>) => get<Any>("health");

export const resolveConflict = ({ data }: Call<{ id: string; notes: string }>) =>
  post<{ ok: boolean }>("conflicts/resolve", data);

export const updateGapStatus = ({ data }: Call<{ id: string; status: string }>) =>
  post<{ ok: boolean }>("gaps/status", data);

export const reportKnowledgeIssue = ({ data }: Call<Any>) =>
  post<{ id: string }>("issues/report", data);

/* --------------------------------------------------------------- preview/test */

export const previewKnowledge = ({ data }: Call<{ question: string; lang?: string }>) =>
  post<Any>("preview", data);

/* ------------------------------------------------------------- export & demo */

export const exportCenterConfiguration = (_?: Call<never>) => get<Any>("export");

export const seedCenterDemoData = (_?: Call<never>) => post<Any>("seed");

/* --------------------------------------------------------- unified source library */

export const listKnowledgeSources = ({
  data,
}: Call<{
  search?: string;
  kind?: string;
  status?: string;
  language?: string;
  domain?: string;
  page?: number;
  pageSize?: number;
}>) => post<Any>("sources/list", data ?? {});

export const getKnowledgeSource = ({ data }: Call<{ kind: string; id: string }>) =>
  post<Any>("sources/get", data);

export const setKnowledgeSourceEnabled = ({
  data,
}: Call<{ kind: string; id: string; enabled: boolean }>) =>
  post<{ ok: boolean }>("sources/enable", data);

export const deleteKnowledgeSource = ({
  data,
}: Call<{ kind: string; id: string; reason?: string }>) =>
  post<Any>("sources/delete", data);

export const testKnowledgeSource = ({
  data,
}: Call<{ kind: string; id: string; question: string; lang?: string }>) =>
  post<Any>("sources/test", data);

/* ------------------------------------------------------- semantic index repair */

export const rebuildSemanticIndex = (args?: Call<{ limit?: number }>) =>
  post<{ documents: number; web: number }>("index/rebuild", args?.data ?? {});
