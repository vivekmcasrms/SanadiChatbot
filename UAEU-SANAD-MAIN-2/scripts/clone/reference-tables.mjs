/**
 * Tables copied from production into the TEST duplicate.
 *
 * Only master / reference / configuration data appears here. Transactional and
 * personal production records (cases, chats, messages, notifications, issued
 * documents, receipts, telemetry, CV records, appointments booked by real
 * students) are deliberately excluded — the duplicate uses test accounts and
 * generates its own transactional data.
 *
 * Copy order matters: parents before children.
 */
export const REFERENCE_TABLES = [
  // Institution structure
  "campuses",
  "colleges",
  "departments",
  "service_units",
  "service_unit_owners",
  "service_staff",
  "staff_availability_rules",
  "service_requirements",
  "service_workflow_steps",
  "service_level_rules",
  "service_availability_windows",
  "service_baselines",

  // Case handling configuration
  "case_categories",
  "routing_rules",
  "escalation_policies",
  "follow_up_policies",
  "automation_policies",
  "data_authority_rules",
  "action_revalidation_policies",

  // Appointments configuration
  "appointment_types",

  // Academic catalogue
  "academic_terms",
  "academic_programs",
  "courses",
  "course_prerequisites",
  "program_courses",
  "program_requirement_baskets",
  "program_basket_courses",
  "programme_course_equivalencies",
  "programme_transfer_capacity",

  // Careers / internships reference data
  "career_roles",
  "career_matching_weight_profiles",
  "ats_scoring_profiles",
  "internship_matching_weights",

  // Library reference data
  "library_locations",
  "library_services",
  "library_opening_hours",
  "library_hours_exceptions",

  // Housing reference data
  "hostels",
  "hostel_rooms",
  "housing_eligibility_rules",

  // Knowledge Center
  "knowledge_document_categories",
  "knowledge_sources",
  "knowledge_documents",
  "document_chunks",
  "bilingual_terms",
  "faq_items",

  // System configuration
  "emergency_contacts",
  "ai_settings",
  "agent_tools",
  "agent_prompt_versions",
  "model_routing_rules",
  "document_templates",
  "document_retention_policies",
  "email_templates",
  "notification_templates",
  "notification_event_types",
  "notification_settings",
  "quality_targets",
  "performance_budgets",
];

/**
 * Never copied. Listed so the report and the scripts agree on what stays behind.
 */
export const EXCLUDED_TABLES = [
  "cases",
  "case_comments",
  "case_assignments",
  "case_status_history",
  "case_evidence",
  "case_resolutions",
  "conversations",
  "messages",
  "message_attachments",
  "conversation_state",
  "notification_events",
  "notification_deliveries",
  "issued_documents",
  "student_documents",
  "student_cv_documents",
  "student_appointments",
  "appointment_requests",
  "appointment_slots",
  "action_requests",
  "action_receipts",
  "agent_runs",
  "agent_tool_executions",
  "agent_model_invocations",
  "response_performance_logs",
  "knowledge_retrieval_logs",
  "audit_logs",
];
