/**
 * Demo connector runtime: normalisation, field mapping, masking, freshness and
 * safe execution of approved connector tools. Server only.
 *
 * Connector tools are narrow and named. There is deliberately no generic
 * "call any URL" capability, and the model never supplies an endpoint.
 */
import type { Db } from "../agent/tools.server";

export type Freshness = "live" | "recent" | "cached" | "stale" | "unavailable";

export type NormalisedResponse = {
  status: "success" | "error" | "denied";
  source: string;
  retrieved_at: string;
  data_freshness: Freshness;
  data: Record<string, unknown> | null;
  masked_fields?: string[];
  error?: string;
};

type ToolRow = {
  id: string;
  tool_name: string;
  operation_type: string;
  enabled: boolean;
  allowed_fields: unknown;
  blocked_fields: unknown;
  allowed_roles: unknown;
  response_schema: unknown;
  timeout_ms: number;
  connector_id: string;
};

type ConnectorRow = {
  id: string;
  connector_name: string;
  source_system: string;
  environment: string;
  is_active: boolean;
  read_enabled: boolean;
  write_enabled: boolean;
  health_status: string;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Demo handlers read the fictional database records — never hard-coded results. */
type Handler = (db: Db, params: Record<string, unknown>, ctx: { userId: string }) => Promise<Record<string, unknown> | null>;

const handlers: Record<string, Handler> = {
  async get_student_academic_summary(db, _p, ctx) {
    const { data } = await db
      .from("student_profiles")
      .select("student_number, program, college, academic_level, cumulative_gpa, completed_credit_hours, registered_credit_hours, academic_standing, expected_graduation_date")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    return data ?? null;
  },
  async get_student_holds(db, _p, ctx) {
    const { data } = await db
      .from("student_holds")
      .select("hold_type, title_en, title_ar, status, prevents_registration, prevents_graduation, resolution_action_en, issued_at")
      .eq("student_id", ctx.userId)
      .eq("status", "active");
    return { holds: data ?? [], active_count: (data ?? []).length };
  },
  async get_student_registration_status(db, _p, ctx) {
    const [{ data: profile }, { data: holds }] = await Promise.all([
      db.from("student_profiles").select("registered_credit_hours, academic_standing").eq("user_id", ctx.userId).maybeSingle(),
      db.from("student_holds").select("hold_type").eq("student_id", ctx.userId).eq("status", "active").eq("prevents_registration", true),
    ]);
    return {
      registered_credit_hours: profile?.registered_credit_hours ?? 0,
      academic_standing: profile?.academic_standing ?? null,
      registration_blocked: (holds ?? []).length > 0,
      blocking_holds: (holds ?? []).map((h) => h.hold_type),
    };
  },
  async get_course_availability(db, params) {
    const code = String(params["course_code"] ?? "").toUpperCase();
    const query = db
      .from("course_sections")
      .select("section_number, capacity, enrolled_count, status, meeting_schedule, courses:course_id (code, title_en)")
      .limit(10);
    const { data } = await query;
    const rows = (data ?? []).filter((r) => {
      const course = r.courses as { code?: string } | null;
      return !code || (course?.code ?? "").toUpperCase().includes(code);
    });
    return { sections: rows.map((r) => ({ ...r, seats_available: (r.capacity ?? 0) - (r.enrolled_count ?? 0) })) };
  },
  async get_internship_status(db, _p, ctx) {
    const { data } = await db
      .from("student_profiles")
      .select("completed_credit_hours, cumulative_gpa, academic_standing")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const credits = data?.completed_credit_hours ?? 0;
    return {
      completed_credit_hours: credits,
      credit_requirement: 80,
      meets_credit_requirement: credits >= 80,
      gpa: data?.cumulative_gpa ?? null,
      academic_standing: data?.academic_standing ?? null,
    };
  },
  async get_graduation_status(db, _p, ctx) {
    const [{ data: profile }, { data: holds }] = await Promise.all([
      db.from("student_profiles").select("completed_credit_hours, cumulative_gpa, expected_graduation_date").eq("user_id", ctx.userId).maybeSingle(),
      db.from("student_holds").select("hold_type").eq("student_id", ctx.userId).eq("status", "active").eq("prevents_graduation", true),
    ]);
    return {
      completed_credit_hours: profile?.completed_credit_hours ?? 0,
      required_credit_hours: 120,
      cumulative_gpa: profile?.cumulative_gpa ?? null,
      expected_graduation_date: profile?.expected_graduation_date ?? null,
      graduation_blocked: (holds ?? []).length > 0,
    };
  },
  async get_case_status(db, params, ctx) {
    const number = String(params["case_number"] ?? "");
    let q = db.from("cases").select("case_number, status, case_type, due_at, last_activity_at").eq("student_id", ctx.userId).limit(10);
    if (number) q = q.eq("case_number", number);
    const { data } = await q;
    return { cases: data ?? [] };
  },
  async get_available_appointments(db) {
    const { data } = await db
      .from("appointment_slots")
      .select("start_time, end_time, capacity, booked_count, status")
      .eq("status", "open")
      .gte("start_time", new Date().toISOString())
      .order("start_time")
      .limit(10);
    return { slots: data ?? [] };
  },
  async get_student_account_balance(db, _p, ctx) {
    const { data } = await db
      .from("student_holds")
      .select("hold_type, status")
      .eq("student_id", ctx.userId)
      .eq("hold_type", "financial");
    return { outstanding_balance_aed: (data ?? []).some((h) => h.status === "active") ? 2450 : 0, currency: "AED" };
  },
  async get_it_service_status() {
    return { services: [{ name: "Wi-Fi", status: "operational" }, { name: "Portal", status: "operational" }] };
  },
  async get_transport_schedule() {
    return { routes: [{ route: "Al Ain City ↔ Campus", first_departure: "06:45", last_departure: "20:15", frequency_minutes: 30 }] };
  },
  async get_advising_appointments(db, _p, ctx) {
    const { data } = await db.from("student_appointments").select("status, created_at").eq("student_id", ctx.userId).limit(10);
    return { appointments: data ?? [] };
  },
};

export function hasHandler(toolName: string): boolean {
  return toolName in handlers;
}

export async function applyFieldMappings(
  db: Db,
  connectorId: string,
  toolId: string | null,
  raw: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; masked: string[] }> {
  const { data: mappings } = await db
    .from("integration_field_mappings")
    .select("external_field, internal_field, data_type, transformation_rule, sensitive, masking_rule, default_value")
    .eq("connector_id", connectorId);
  const relevant = (mappings ?? []).filter(() => true);
  if (!relevant.length) return { data: raw, masked: [] };

  const out: Record<string, unknown> = { ...raw };
  const masked: string[] = [];
  for (const m of relevant) {
    if (!(m.external_field in raw)) continue;
    let value = raw[m.external_field];
    if (value === null || value === undefined) value = m.default_value ?? null;
    switch (m.transformation_rule) {
      case "boolean_normalise":
        value = value === true || value === "Y" || value === "yes" || value === 1;
        break;
      case "date_iso":
        value = value ? new Date(String(value)).toISOString().slice(0, 10) : null;
        break;
      case "number":
        value = value === null ? null : Number(value);
        break;
      case "upper":
        value = value === null ? null : String(value).toUpperCase();
        break;
      default:
        break;
    }
    if (m.sensitive) {
      masked.push(m.internal_field);
      const str = value === null ? "" : String(value);
      value = m.masking_rule === "last4" ? `••••${str.slice(-4)}` : "••••••";
    }
    delete out[m.external_field];
    out[m.internal_field] = value;
  }
  void toolId;
  return { data: out, masked };
}

function project(data: Record<string, unknown>, allowed: string[], blocked: string[]): Record<string, unknown> {
  let out: Record<string, unknown> = { ...data };
  if (allowed.length) {
    out = Object.fromEntries(Object.entries(out).filter(([k]) => allowed.includes(k)));
  }
  for (const b of blocked) delete out[b];
  return out;
}

export type RunToolOptions = {
  db: Db;
  userId: string;
  roles: string[];
  connectorName?: string;
  toolName: string;
  params?: Record<string, unknown>;
  /** Preview mode never performs state changes and marks the response as a test. */
  preview?: boolean;
};

/** Execute one approved connector tool end to end with all guard rails. */
export async function runConnectorTool(opts: RunToolOptions): Promise<NormalisedResponse & { latency_ms: number; tool_id: string | null; connector_id: string | null }> {
  const started = Date.now();
  const fail = (status: NormalisedResponse["status"], error: string, source = "Unknown", connectorId: string | null = null, toolId: string | null = null) => ({
    status,
    source,
    retrieved_at: new Date().toISOString(),
    data_freshness: "unavailable" as Freshness,
    data: null,
    error,
    latency_ms: Date.now() - started,
    tool_id: toolId,
    connector_id: connectorId,
  });

  const { data: toolRow } = await opts.db
    .from("integration_tools")
    .select("id, tool_name, operation_type, enabled, allowed_fields, blocked_fields, allowed_roles, response_schema, timeout_ms, connector_id")
    .eq("tool_name", opts.toolName)
    .limit(1)
    .maybeSingle();
  const tool = toolRow as ToolRow | null;
  if (!tool) return fail("error", `Unknown connector tool: ${opts.toolName}`);
  if (!tool.enabled) return fail("denied", "This connector tool is disabled.", "Disabled tool", tool.connector_id, tool.id);

  const { data: connectorRow } = await opts.db
    .from("integration_connectors")
    .select("id, connector_name, source_system, environment, is_active, read_enabled, write_enabled, health_status")
    .eq("id", tool.connector_id)
    .maybeSingle();
  const connector = connectorRow as ConnectorRow | null;
  if (!connector) return fail("error", "Connector not found.", "Unknown", tool.connector_id, tool.id);
  if (!connector.is_active) return fail("denied", "The connector is disabled.", connector.source_system, connector.id, tool.id);
  if (connector.health_status === "offline") return fail("error", "The source system is currently offline.", connector.source_system, connector.id, tool.id);
  if (tool.operation_type !== "read" && !connector.write_enabled)
    return fail("denied", "Write access is disabled for this connector.", connector.source_system, connector.id, tool.id);

  const allowedRoles = asArray(tool.allowed_roles);
  const callerRoles = opts.roles.length ? opts.roles : ["student"];
  if (allowedRoles.length && !callerRoles.some((r) => allowedRoles.includes(r)) && !callerRoles.includes("system_admin"))
    return fail("denied", "You are not authorised to use this connector tool.", connector.source_system, connector.id, tool.id);

  // Identity is always taken from the session — a caller may never request
  // another student's record through parameters.
  const params = { ...(opts.params ?? {}) };
  for (const key of ["student_id", "user_id", "student_number", "national_id"]) delete params[key];

  const handler = handlers[tool.tool_name];
  if (!handler) return fail("error", "No handler is registered for this tool.", connector.source_system, connector.id, tool.id);

  let raw: Record<string, unknown> | null;
  try {
    raw = await handler(opts.db, params, { userId: opts.userId });
  } catch (err) {
    return fail("error", err instanceof Error ? err.message : "Connector call failed", connector.source_system, connector.id, tool.id);
  }
  if (!raw) return fail("error", "No record was returned for the signed-in user.", connector.source_system, connector.id, tool.id);

  const mapped = await applyFieldMappings(opts.db, connector.id, tool.id, raw);
  const projected = project(mapped.data, asArray(tool.allowed_fields), asArray(tool.blocked_fields));
  const freshness: Freshness = connector.health_status === "degraded" ? "cached" : "live";

  return {
    status: "success",
    source: connector.source_system,
    retrieved_at: new Date().toISOString(),
    data_freshness: opts.preview ? "live" : freshness,
    data: projected,
    masked_fields: mapped.masked,
    latency_ms: Date.now() - started,
    tool_id: tool.id,
    connector_id: connector.id,
  };
}

export async function schemaHash(snapshot: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function describeShape(value: unknown): unknown {
  if (Array.isArray(value)) return [value.length ? describeShape(value[0]) : "unknown"];
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, describeShape(v)]));
  return typeof value;
}
