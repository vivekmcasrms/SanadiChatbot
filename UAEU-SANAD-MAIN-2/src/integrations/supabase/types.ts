export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      academic_programs: {
        Row: {
          code: string
          college_id: string | null
          created_at: string
          degree_level: string
          department_id: string | null
          id: string
          internship_minimum_credits: number
          internship_required: boolean
          is_active: boolean
          maximum_study_years: number
          minimum_gpa: number
          name_ar: string
          name_en: string
          total_credit_hours: number
          updated_at: string
        }
        Insert: {
          code: string
          college_id?: string | null
          created_at?: string
          degree_level?: string
          department_id?: string | null
          id?: string
          internship_minimum_credits?: number
          internship_required?: boolean
          is_active?: boolean
          maximum_study_years?: number
          minimum_gpa?: number
          name_ar: string
          name_en: string
          total_credit_hours?: number
          updated_at?: string
        }
        Update: {
          code?: string
          college_id?: string | null
          created_at?: string
          degree_level?: string
          department_id?: string | null
          id?: string
          internship_minimum_credits?: number
          internship_required?: boolean
          is_active?: boolean
          maximum_study_years?: number
          minimum_gpa?: number
          name_ar?: string
          name_en?: string
          total_credit_hours?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_programs_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_programs_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_terms: {
        Row: {
          add_drop_deadline: string | null
          code: string
          created_at: string
          end_date: string
          exam_end: string | null
          exam_start: string | null
          id: string
          is_active: boolean
          is_current: boolean
          name_ar: string
          name_en: string
          registration_end: string | null
          registration_start: string | null
          start_date: string
          university_id: string | null
          updated_at: string
          withdrawal_deadline: string | null
        }
        Insert: {
          add_drop_deadline?: string | null
          code: string
          created_at?: string
          end_date: string
          exam_end?: string | null
          exam_start?: string | null
          id?: string
          is_active?: boolean
          is_current?: boolean
          name_ar: string
          name_en: string
          registration_end?: string | null
          registration_start?: string | null
          start_date: string
          university_id?: string | null
          updated_at?: string
          withdrawal_deadline?: string | null
        }
        Update: {
          add_drop_deadline?: string | null
          code?: string
          created_at?: string
          end_date?: string
          exam_end?: string | null
          exam_start?: string | null
          id?: string
          is_active?: boolean
          is_current?: boolean
          name_ar?: string
          name_en?: string
          registration_end?: string | null
          registration_start?: string | null
          start_date?: string
          university_id?: string | null
          updated_at?: string
          withdrawal_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "academic_terms_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      action_approvals: {
        Row: {
          action_key: string
          affected_service: string | null
          approver_id: string | null
          created_at: string
          data_shared: string | null
          expected_outcome: string | null
          id: string
          payload: Json
          receipt_number: string | null
          risk_level: Database["public"]["Enums"]["action_risk"]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_key: string
          affected_service?: string | null
          approver_id?: string | null
          created_at?: string
          data_shared?: string | null
          expected_outcome?: string | null
          id?: string
          payload?: Json
          receipt_number?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"]
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_key?: string
          affected_service?: string | null
          approver_id?: string | null
          created_at?: string
          data_shared?: string | null
          expected_outcome?: string | null
          id?: string
          payload?: Json
          receipt_number?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      action_receipts: {
        Row: {
          action_request_id: string | null
          action_type: string
          appointment_id: string | null
          case_id: string | null
          created_at: string
          current_status: string
          expected_first_response_at: string | null
          expected_resolution_at: string | null
          id: string
          language: Database["public"]["Enums"]["lang_code"]
          next_step_ar: string | null
          next_step_en: string | null
          payload: Json
          receipt_number: string
          reference_number: string | null
          responsible_unit_id: string | null
          responsible_unit_name: string | null
          student_id: string
          submitted_at: string
          suggestion_id: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          action_request_id?: string | null
          action_type: string
          appointment_id?: string | null
          case_id?: string | null
          created_at?: string
          current_status?: string
          expected_first_response_at?: string | null
          expected_resolution_at?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          next_step_ar?: string | null
          next_step_en?: string | null
          payload?: Json
          receipt_number: string
          reference_number?: string | null
          responsible_unit_id?: string | null
          responsible_unit_name?: string | null
          student_id: string
          submitted_at?: string
          suggestion_id?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          action_request_id?: string | null
          action_type?: string
          appointment_id?: string | null
          case_id?: string | null
          created_at?: string
          current_status?: string
          expected_first_response_at?: string | null
          expected_resolution_at?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          next_step_ar?: string | null
          next_step_en?: string | null
          payload?: Json
          receipt_number?: string
          reference_number?: string | null
          responsible_unit_id?: string | null
          responsible_unit_name?: string | null
          student_id?: string
          submitted_at?: string
          suggestion_id?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_receipts_action_request_id_fkey"
            columns: ["action_request_id"]
            isOneToOne: false
            referencedRelation: "action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_receipts_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "student_appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_receipts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_receipts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_receipts_responsible_unit_id_fkey"
            columns: ["responsible_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_receipts_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      action_request_documents: {
        Row: {
          action_request_id: string
          created_at: string
          id: string
          included_with_consent: boolean
          student_document_id: string
        }
        Insert: {
          action_request_id: string
          created_at?: string
          id?: string
          included_with_consent?: boolean
          student_document_id: string
        }
        Update: {
          action_request_id?: string
          created_at?: string
          id?: string
          included_with_consent?: boolean
          student_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_request_documents_action_request_id_fkey"
            columns: ["action_request_id"]
            isOneToOne: false
            referencedRelation: "action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_request_documents_student_document_id_fkey"
            columns: ["student_document_id"]
            isOneToOne: false
            referencedRelation: "student_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      action_requests: {
        Row: {
          action_type: string
          approved_at: string | null
          approved_by: string | null
          case_id: string | null
          conversation_id: string | null
          created_at: string
          executed_at: string | null
          execution_result: Json | null
          execution_status: string
          human_approval_required: boolean
          id: string
          proposed_payload: Json
          receipt_number: string | null
          risk_level: Database["public"]["Enums"]["action_risk"]
          student_confirmation_required: boolean
          student_confirmed_at: string | null
          student_id: string
          university_service_id: string | null
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          approved_by?: string | null
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          executed_at?: string | null
          execution_result?: Json | null
          execution_status?: string
          human_approval_required?: boolean
          id?: string
          proposed_payload?: Json
          receipt_number?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"]
          student_confirmation_required?: boolean
          student_confirmed_at?: string | null
          student_id: string
          university_service_id?: string | null
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          approved_by?: string | null
          case_id?: string | null
          conversation_id?: string | null
          created_at?: string
          executed_at?: string | null
          execution_result?: Json | null
          execution_status?: string
          human_approval_required?: boolean
          id?: string
          proposed_payload?: Json
          receipt_number?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"]
          student_confirmation_required?: boolean
          student_confirmed_at?: string | null
          student_id?: string
          university_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_requests_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_requests_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      action_revalidation_events: {
        Row: {
          action_code: string
          actor_id: string | null
          authoritative_source: string | null
          changed: boolean
          checks: Json
          created_at: string
          duration_ms: number | null
          executed_at: string
          id: string
          live_value: Json | null
          original_value: Json | null
          recovery_action: Json | null
          recovery_classification: string | null
          revalidation_result: string
          service_code: string | null
          snapshot_at: string | null
          student_confirmation_required: boolean
          student_id: string | null
          trace_id: string | null
          transaction_result: string | null
        }
        Insert: {
          action_code: string
          actor_id?: string | null
          authoritative_source?: string | null
          changed?: boolean
          checks?: Json
          created_at?: string
          duration_ms?: number | null
          executed_at?: string
          id?: string
          live_value?: Json | null
          original_value?: Json | null
          recovery_action?: Json | null
          recovery_classification?: string | null
          revalidation_result: string
          service_code?: string | null
          snapshot_at?: string | null
          student_confirmation_required?: boolean
          student_id?: string | null
          trace_id?: string | null
          transaction_result?: string | null
        }
        Update: {
          action_code?: string
          actor_id?: string | null
          authoritative_source?: string | null
          changed?: boolean
          checks?: Json
          created_at?: string
          duration_ms?: number | null
          executed_at?: string
          id?: string
          live_value?: Json | null
          original_value?: Json | null
          recovery_action?: Json | null
          recovery_classification?: string | null
          revalidation_result?: string
          service_code?: string | null
          snapshot_at?: string | null
          student_confirmation_required?: boolean
          student_id?: string | null
          trace_id?: string | null
          transaction_result?: string | null
        }
        Relationships: []
      }
      action_revalidation_policies: {
        Row: {
          action_code: string
          check_conflicting_transaction: boolean
          check_eligibility: boolean
          check_existing_assignment: boolean
          check_holds: boolean
          check_policy_version: boolean
          check_resource_capacity: boolean
          check_service_window: boolean
          check_student_status: boolean
          created_at: string
          custom_validation_function: string | null
          enabled: boolean
          hold_types: string[]
          id: string
          notes: string | null
          recovery_mode: string
          resource_type: string | null
          service_code: string | null
          updated_at: string
        }
        Insert: {
          action_code: string
          check_conflicting_transaction?: boolean
          check_eligibility?: boolean
          check_existing_assignment?: boolean
          check_holds?: boolean
          check_policy_version?: boolean
          check_resource_capacity?: boolean
          check_service_window?: boolean
          check_student_status?: boolean
          created_at?: string
          custom_validation_function?: string | null
          enabled?: boolean
          hold_types?: string[]
          id?: string
          notes?: string | null
          recovery_mode?: string
          resource_type?: string | null
          service_code?: string | null
          updated_at?: string
        }
        Update: {
          action_code?: string
          check_conflicting_transaction?: boolean
          check_eligibility?: boolean
          check_existing_assignment?: boolean
          check_holds?: boolean
          check_policy_version?: boolean
          check_resource_capacity?: boolean
          check_service_window?: boolean
          check_student_status?: boolean
          created_at?: string
          custom_validation_function?: string | null
          enabled?: boolean
          hold_types?: string[]
          id?: string
          notes?: string | null
          recovery_mode?: string
          resource_type?: string | null
          service_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_model_invocations: {
        Row: {
          agent_run_id: string | null
          call_sequence: number
          completion_tokens: number
          conversation_id: string | null
          created_at: string
          error_category: string | null
          estimated_input_tokens: number
          id: string
          lane: string
          lane_queue_ms: number
          model_name: string
          necessity_reason: string
          prompt_breakdown: Json
          prompt_tokens: number
          provider: string
          provider_duration_ms: number
          provider_first_token_ms: number | null
          purpose: string
          result_used: boolean
          status: string
          tool_names: string[]
          total_duration_ms: number
          trace_id: string
        }
        Insert: {
          agent_run_id?: string | null
          call_sequence: number
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          error_category?: string | null
          estimated_input_tokens?: number
          id?: string
          lane: string
          lane_queue_ms?: number
          model_name: string
          necessity_reason: string
          prompt_breakdown?: Json
          prompt_tokens?: number
          provider: string
          provider_duration_ms?: number
          provider_first_token_ms?: number | null
          purpose: string
          result_used?: boolean
          status?: string
          tool_names?: string[]
          total_duration_ms?: number
          trace_id: string
        }
        Update: {
          agent_run_id?: string | null
          call_sequence?: number
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          error_category?: string | null
          estimated_input_tokens?: number
          id?: string
          lane?: string
          lane_queue_ms?: number
          model_name?: string
          necessity_reason?: string
          prompt_breakdown?: Json
          prompt_tokens?: number
          provider?: string
          provider_duration_ms?: number
          provider_first_token_ms?: number | null
          purpose?: string
          result_used?: boolean
          status?: string
          tool_names?: string[]
          total_duration_ms?: number
          trace_id?: string
        }
        Relationships: []
      }
      agent_prompt_versions: {
        Row: {
          agent_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          effective_from: string | null
          id: string
          language: Database["public"]["Enums"]["lang_code"]
          notes: string | null
          status: string
          system_prompt: string
          updated_at: string
          version: number
        }
        Insert: {
          agent_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          notes?: string | null
          status?: string
          system_prompt: string
          updated_at?: string
          version: number
        }
        Update: {
          agent_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          effective_from?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          notes?: string | null
          status?: string
          system_prompt?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      agent_runs: {
        Row: {
          agent: string
          confidence: number | null
          conversation_id: string | null
          created_at: string
          error_message: string | null
          estimated_cost_usd: number | null
          failed_tool_count: number
          fallback_used: boolean
          human_handoff: boolean
          id: string
          input: Json
          language: Database["public"]["Enums"]["lang_code"] | null
          latency_ms: number | null
          model_name: string | null
          output: Json
          prompt_version: string | null
          provider: string | null
          response_type: string | null
          schema_valid: boolean | null
          status: string
          tool_call_count: number
          user_id: string
        }
        Insert: {
          agent: string
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          failed_tool_count?: number
          fallback_used?: boolean
          human_handoff?: boolean
          id?: string
          input?: Json
          language?: Database["public"]["Enums"]["lang_code"] | null
          latency_ms?: number | null
          model_name?: string | null
          output?: Json
          prompt_version?: string | null
          provider?: string | null
          response_type?: string | null
          schema_valid?: boolean | null
          status?: string
          tool_call_count?: number
          user_id: string
        }
        Update: {
          agent?: string
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number | null
          failed_tool_count?: number
          fallback_used?: boolean
          human_handoff?: boolean
          id?: string
          input?: Json
          language?: Database["public"]["Enums"]["lang_code"] | null
          latency_ms?: number | null
          model_name?: string | null
          output?: Json
          prompt_version?: string | null
          provider?: string | null
          response_type?: string | null
          schema_valid?: boolean | null
          status?: string
          tool_call_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tool_executions: {
        Row: {
          agent_run_id: string | null
          approval_status: string
          authorization_result: string
          completed_at: string | null
          confirmation_status: string
          conversation_id: string | null
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          execution_status: string
          id: string
          input_payload: Json
          output_payload: Json | null
          requested_by_profile_id: string
          risk_level: Database["public"]["Enums"]["action_risk"]
          started_at: string
          tool_id: string | null
          tool_name: string
        }
        Insert: {
          agent_run_id?: string | null
          approval_status?: string
          authorization_result?: string
          completed_at?: string | null
          confirmation_status?: string
          conversation_id?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_status?: string
          id?: string
          input_payload?: Json
          output_payload?: Json | null
          requested_by_profile_id: string
          risk_level?: Database["public"]["Enums"]["action_risk"]
          started_at?: string
          tool_id?: string | null
          tool_name: string
        }
        Update: {
          agent_run_id?: string | null
          approval_status?: string
          authorization_result?: string
          completed_at?: string | null
          confirmation_status?: string
          conversation_id?: string | null
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          execution_status?: string
          id?: string
          input_payload?: Json
          output_payload?: Json | null
          requested_by_profile_id?: string
          risk_level?: Database["public"]["Enums"]["action_risk"]
          started_at?: string
          tool_id?: string | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_tool_executions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_executions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_tool_executions_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "agent_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tools: {
        Row: {
          agent_type: string
          allowed_roles: Json
          audit_required: boolean
          authentication_required: boolean
          confirmation_required: boolean
          created_at: string
          description: string
          enabled: boolean
          human_approval_required: boolean
          id: string
          input_schema: Json
          output_schema: Json
          risk_level: Database["public"]["Enums"]["action_risk"]
          timeout_ms: number
          tool_name: string
          updated_at: string
        }
        Insert: {
          agent_type?: string
          allowed_roles?: Json
          audit_required?: boolean
          authentication_required?: boolean
          confirmation_required?: boolean
          created_at?: string
          description: string
          enabled?: boolean
          human_approval_required?: boolean
          id?: string
          input_schema?: Json
          output_schema?: Json
          risk_level?: Database["public"]["Enums"]["action_risk"]
          timeout_ms?: number
          tool_name: string
          updated_at?: string
        }
        Update: {
          agent_type?: string
          allowed_roles?: Json
          audit_required?: boolean
          authentication_required?: boolean
          confirmation_required?: boolean
          created_at?: string
          description?: string
          enabled?: boolean
          human_approval_required?: boolean
          id?: string
          input_schema?: Json
          output_schema?: Json
          risk_level?: Database["public"]["Enums"]["action_risk"]
          timeout_ms?: number
          tool_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_human_edits: {
        Row: {
          agent_run_id: string | null
          case_id: string | null
          created_at: string
          edit_category: string
          edit_reason: string | null
          edited_content: string
          editor_profile_id: string
          entity_id: string | null
          entity_type: string
          id: string
          original_ai_content: string
        }
        Insert: {
          agent_run_id?: string | null
          case_id?: string | null
          created_at?: string
          edit_category?: string
          edit_reason?: string | null
          edited_content: string
          editor_profile_id: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          original_ai_content: string
        }
        Update: {
          agent_run_id?: string | null
          case_id?: string | null
          created_at?: string
          edit_category?: string
          edit_reason?: string | null
          edited_content?: string
          editor_profile_id?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          original_ai_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_human_edits_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_human_edits_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_human_edits_editor_profile_id_fkey"
            columns: ["editor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          ai_enabled: boolean
          confidence_threshold: number
          created_at: string
          embedding_model: string
          fallback_model: string | null
          fallback_provider: string | null
          handoff_threshold: number
          id: string
          max_output_tokens: number
          max_tool_calls: number
          model_name: string
          provider: string
          reasoning_effort: string
          request_timeout_ms: number
          retrieval_top_k: number
          temperature: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          embedding_model?: string
          fallback_model?: string | null
          fallback_provider?: string | null
          handoff_threshold?: number
          id?: string
          max_output_tokens?: number
          max_tool_calls?: number
          model_name?: string
          provider?: string
          reasoning_effort?: string
          request_timeout_ms?: number
          retrieval_top_k?: number
          temperature?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_enabled?: boolean
          confidence_threshold?: number
          created_at?: string
          embedding_model?: string
          fallback_model?: string | null
          fallback_provider?: string | null
          handoff_threshold?: number
          id?: string
          max_output_tokens?: number
          max_tool_calls?: number
          model_name?: string
          provider?: string
          reasoning_effort?: string
          request_timeout_ms?: number
          retrieval_top_k?: number
          temperature?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      alert_deduplication: {
        Row: {
          alert_rule_id: string | null
          condition_key: string
          current_status: string
          first_generated_at: string
          id: string
          last_condition_hash: string | null
          last_generated_at: string
          source_record_id: string | null
          student_id: string
        }
        Insert: {
          alert_rule_id?: string | null
          condition_key: string
          current_status?: string
          first_generated_at?: string
          id?: string
          last_condition_hash?: string | null
          last_generated_at?: string
          source_record_id?: string | null
          student_id: string
        }
        Update: {
          alert_rule_id?: string | null
          condition_key?: string
          current_status?: string
          first_generated_at?: string
          id?: string
          last_condition_hash?: string | null
          last_generated_at?: string
          source_record_id?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_deduplication_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deduplication_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rule_conditions: {
        Row: {
          alert_rule_id: string
          comparison_value: Json | null
          condition_group: number
          created_at: string
          evaluation_order: number
          field_name: string
          field_source: string
          id: string
          operator: string
        }
        Insert: {
          alert_rule_id: string
          comparison_value?: Json | null
          condition_group?: number
          created_at?: string
          evaluation_order?: number
          field_name: string
          field_source: string
          id?: string
          operator: string
        }
        Update: {
          alert_rule_id?: string
          comparison_value?: Json | null
          condition_group?: number
          created_at?: string
          evaluation_order?: number
          field_name?: string
          field_source?: string
          id?: string
          operator?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rule_conditions_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rule_runs: {
        Row: {
          alert_rule_id: string | null
          alerts_created: number
          alerts_skipped: number
          completed_at: string | null
          error_summary: string | null
          errors_count: number
          id: string
          records_evaluated: number
          run_status: string
          started_at: string
        }
        Insert: {
          alert_rule_id?: string | null
          alerts_created?: number
          alerts_skipped?: number
          completed_at?: string | null
          error_summary?: string | null
          errors_count?: number
          id?: string
          records_evaluated?: number
          run_status?: string
          started_at?: string
        }
        Update: {
          alert_rule_id?: string | null
          alerts_created?: number
          alerts_skipped?: number
          completed_at?: string | null
          error_summary?: string | null
          errors_count?: number
          id?: string
          records_evaluated?: number
          run_status?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rule_runs_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          action_label_ar: string | null
          action_label_en: string | null
          action_type: string
          action_url: string | null
          body_template_ar: string | null
          body_template_en: string | null
          category: string
          created_at: string
          criteria: Json
          days_before_deadline: number | null
          delivery_channels: string[]
          description: string | null
          event_type: string
          id: string
          is_active: boolean
          name: string
          related_service_id: string | null
          severity: Database["public"]["Enums"]["urgency_level"]
          target_condition: Json
          title_template_ar: string | null
          title_template_en: string | null
        }
        Insert: {
          action_label_ar?: string | null
          action_label_en?: string | null
          action_type?: string
          action_url?: string | null
          body_template_ar?: string | null
          body_template_en?: string | null
          category?: string
          created_at?: string
          criteria?: Json
          days_before_deadline?: number | null
          delivery_channels?: string[]
          description?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          name: string
          related_service_id?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          target_condition?: Json
          title_template_ar?: string | null
          title_template_en?: string | null
        }
        Update: {
          action_label_ar?: string | null
          action_label_en?: string | null
          action_type?: string
          action_url?: string | null
          body_template_ar?: string | null
          body_template_en?: string | null
          category?: string
          created_at?: string
          criteria?: Json
          days_before_deadline?: number | null
          delivery_channels?: string[]
          description?: string | null
          event_type?: string
          id?: string
          is_active?: boolean
          name?: string
          related_service_id?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          target_condition?: Json
          title_template_ar?: string | null
          title_template_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_related_service_id_fkey"
            columns: ["related_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          action_url: string | null
          body_ar: string
          body_en: string
          category: string
          created_at: string
          deadline_at: string | null
          id: string
          is_active: boolean
          is_campus_wide: boolean
          reason_ar: string | null
          reason_en: string | null
          recommended_action_ar: string | null
          recommended_action_en: string | null
          service_unit_id: string | null
          source_ar: string | null
          source_en: string | null
          title_ar: string
          title_en: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Insert: {
          action_url?: string | null
          body_ar: string
          body_en: string
          category?: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          is_active?: boolean
          is_campus_wide?: boolean
          reason_ar?: string | null
          reason_en?: string | null
          recommended_action_ar?: string | null
          recommended_action_en?: string | null
          service_unit_id?: string | null
          source_ar?: string | null
          source_en?: string | null
          title_ar: string
          title_en: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Update: {
          action_url?: string | null
          body_ar?: string
          body_en?: string
          category?: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          is_active?: boolean
          is_campus_wide?: boolean
          reason_ar?: string | null
          reason_en?: string | null
          recommended_action_ar?: string | null
          recommended_action_en?: string | null
          service_unit_id?: string | null
          source_ar?: string | null
          source_en?: string | null
          title_ar?: string
          title_en?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_requests: {
        Row: {
          alternative_datetime: string | null
          appointment_mode: string
          assigned_at: string | null
          assigned_staff_id: string | null
          assignment_method: string | null
          case_id: string | null
          confirmation_status: string
          confirmed_datetime: string | null
          created_at: string
          decline_reason: string | null
          id: string
          language: string
          location: string | null
          office_response_at: string | null
          preferred_datetime: string
          purpose: string | null
          reference: string | null
          request_status: string
          service_unit_id: string | null
          student_id: string
          student_response_at: string | null
          updated_at: string
          workload_at_assignment: number | null
        }
        Insert: {
          alternative_datetime?: string | null
          appointment_mode?: string
          assigned_at?: string | null
          assigned_staff_id?: string | null
          assignment_method?: string | null
          case_id?: string | null
          confirmation_status?: string
          confirmed_datetime?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          language?: string
          location?: string | null
          office_response_at?: string | null
          preferred_datetime: string
          purpose?: string | null
          reference?: string | null
          request_status?: string
          service_unit_id?: string | null
          student_id: string
          student_response_at?: string | null
          updated_at?: string
          workload_at_assignment?: number | null
        }
        Update: {
          alternative_datetime?: string | null
          appointment_mode?: string
          assigned_at?: string | null
          assigned_staff_id?: string | null
          assignment_method?: string | null
          case_id?: string | null
          confirmation_status?: string
          confirmed_datetime?: string | null
          created_at?: string
          decline_reason?: string | null
          id?: string
          language?: string
          location?: string | null
          office_response_at?: string | null
          preferred_datetime?: string
          purpose?: string | null
          reference?: string | null
          request_status?: string
          service_unit_id?: string | null
          student_id?: string
          student_response_at?: string | null
          updated_at?: string
          workload_at_assignment?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_requests_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_slots: {
        Row: {
          appointment_type_id: string
          booked_count: number
          capacity: number
          created_at: string
          data_source: string
          end_time: string
          id: string
          is_demo_record: boolean
          location: string | null
          meeting_link: string | null
          staff_profile_id: string | null
          start_time: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_type_id: string
          booked_count?: number
          capacity?: number
          created_at?: string
          data_source?: string
          end_time: string
          id?: string
          is_demo_record?: boolean
          location?: string | null
          meeting_link?: string | null
          staff_profile_id?: string | null
          start_time: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_type_id?: string
          booked_count?: number
          capacity?: number
          created_at?: string
          data_source?: string
          end_time?: string
          id?: string
          is_demo_record?: boolean
          location?: string | null
          meeting_link?: string | null
          staff_profile_id?: string | null
          start_time?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_slots_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_slots_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "appointment_slots_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
        ]
      }
      appointment_types: {
        Row: {
          created_at: string
          data_source: string
          duration_minutes: number
          id: string
          is_active: boolean
          is_demo_record: boolean
          location_type: string
          name_ar: string
          name_en: string
          requires_approval: boolean
          service_unit_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_source?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          location_type?: string
          name_ar: string
          name_en: string
          requires_approval?: boolean
          service_unit_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_source?: string
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          location_type?: string
          name_ar?: string
          name_en?: string
          requires_approval?: boolean
          service_unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_types_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          action_request_id: string | null
          approval_status: string
          approval_type: string
          assigned_approver_id: string | null
          assigned_approver_role: Database["public"]["Enums"]["app_role"] | null
          case_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_reason: string | null
          due_at: string | null
          id: string
          request_summary: string
          requested_at: string
          requested_by: string | null
          risk_level: Database["public"]["Enums"]["action_risk"] | null
          supporting_data: Json
          updated_at: string
        }
        Insert: {
          action_request_id?: string | null
          approval_status?: string
          approval_type: string
          assigned_approver_id?: string | null
          assigned_approver_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          case_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          due_at?: string | null
          id?: string
          request_summary: string
          requested_at?: string
          requested_by?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          supporting_data?: Json
          updated_at?: string
        }
        Update: {
          action_request_id?: string | null
          approval_status?: string
          approval_type?: string
          assigned_approver_id?: string | null
          assigned_approver_role?:
            | Database["public"]["Enums"]["app_role"]
            | null
          case_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_reason?: string | null
          due_at?: string | null
          id?: string
          request_summary?: string
          requested_at?: string
          requested_by?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          supporting_data?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_action_request_id_fkey"
            columns: ["action_request_id"]
            isOneToOne: false
            referencedRelation: "action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_assigned_approver_id_fkey"
            columns: ["assigned_approver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ats_scoring_profiles: {
        Row: {
          active: boolean
          bands: Json
          created_at: string
          engine_version: string
          id: string
          role_code: string | null
          scope: string
          updated_at: string
          weights: Json
          weights_version: string
        }
        Insert: {
          active?: boolean
          bands?: Json
          created_at?: string
          engine_version?: string
          id?: string
          role_code?: string | null
          scope: string
          updated_at?: string
          weights?: Json
          weights_version?: string
        }
        Update: {
          active?: boolean
          bands?: Json
          created_at?: string
          engine_version?: string
          id?: string
          role_code?: string | null
          scope?: string
          updated_at?: string
          weights?: Json
          weights_version?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      automation_events: {
        Row: {
          action_key: string
          actor_id: string | null
          actor_type: string
          agent: string
          autonomy_level: string
          case_id: string | null
          confidence: number | null
          created_at: string
          entity_id: string | null
          entity_type: string
          executed: boolean
          human_review_required: boolean
          id: string
          inputs: Json
          policy_id: string | null
          result: Json
          risk_level: Database["public"]["Enums"]["action_risk"] | null
          rule_used: string | null
          summary_ar: string | null
          summary_en: string | null
        }
        Insert: {
          action_key: string
          actor_id?: string | null
          actor_type?: string
          agent?: string
          autonomy_level?: string
          case_id?: string | null
          confidence?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          executed?: boolean
          human_review_required?: boolean
          id?: string
          inputs?: Json
          policy_id?: string | null
          result?: Json
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          rule_used?: string | null
          summary_ar?: string | null
          summary_en?: string | null
        }
        Update: {
          action_key?: string
          actor_id?: string | null
          actor_type?: string
          agent?: string
          autonomy_level?: string
          case_id?: string | null
          confidence?: number | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          executed?: boolean
          human_review_required?: boolean
          id?: string
          inputs?: Json
          policy_id?: string | null
          result?: Json
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          rule_used?: string | null
          summary_ar?: string | null
          summary_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_events_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "automation_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_policies: {
        Row: {
          action_key: string
          applies_to_sensitive: boolean
          autonomy_level: string
          case_type: Database["public"]["Enums"]["case_type"] | null
          created_at: string
          id: string
          is_active: boolean
          min_confidence: number
          notes: string | null
          risk_level: Database["public"]["Enums"]["action_risk"] | null
          service_unit_id: string | null
          updated_at: string
        }
        Insert: {
          action_key: string
          applies_to_sensitive?: boolean
          autonomy_level?: string
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          min_confidence?: number
          notes?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          service_unit_id?: string | null
          updated_at?: string
        }
        Update: {
          action_key?: string
          applies_to_sensitive?: boolean
          autonomy_level?: string
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          id?: string
          is_active?: boolean
          min_confidence?: number
          notes?: string | null
          risk_level?: Database["public"]["Enums"]["action_risk"] | null
          service_unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_policies_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      bilingual_terms: {
        Row: {
          abbreviation: string | null
          alternative_ar: Json
          alternative_en: Json
          approved_at: string | null
          approved_by: string | null
          canonical_ar: string
          canonical_en: string
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          service_unit_id: string | null
          term_category: string
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          alternative_ar?: Json
          alternative_en?: Json
          approved_at?: string | null
          approved_by?: string | null
          canonical_ar: string
          canonical_en: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          service_unit_id?: string | null
          term_category: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          alternative_ar?: Json
          alternative_en?: Json
          approved_at?: string | null
          approved_by?: string | null
          canonical_ar?: string
          canonical_en?: string
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          service_unit_id?: string | null
          term_category?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bilingual_terms_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bilingual_terms_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_exceptions: {
        Row: {
          created_at: string
          custom_end_time: string | null
          custom_start_time: string | null
          exception_date: string
          exception_type: string
          id: string
          is_working_day: boolean
          title_ar: string | null
          title_en: string | null
          working_calendar_id: string
        }
        Insert: {
          created_at?: string
          custom_end_time?: string | null
          custom_start_time?: string | null
          exception_date: string
          exception_type?: string
          id?: string
          is_working_day?: boolean
          title_ar?: string | null
          title_en?: string | null
          working_calendar_id: string
        }
        Update: {
          created_at?: string
          custom_end_time?: string | null
          custom_start_time?: string | null
          exception_date?: string
          exception_type?: string
          id?: string
          is_working_day?: boolean
          title_ar?: string | null
          title_en?: string | null
          working_calendar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_exceptions_working_calendar_id_fkey"
            columns: ["working_calendar_id"]
            isOneToOne: false
            referencedRelation: "working_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      campuses: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          location_ar: string | null
          location_en: string | null
          name_ar: string
          name_en: string
          university_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar: string
          name_en: string
          university_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar?: string
          name_en?: string
          university_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campuses_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      career_analysis_versions: {
        Row: {
          action_plan: Json
          ats: Json | null
          calculated_at: string
          cv_file_name: string | null
          cv_id: string | null
          id: string
          matches: Json
          profile_source: string
          scoring_version: string
          skill_gaps: Json | null
          student_id: string
          version_no: number
          weights: Json
        }
        Insert: {
          action_plan?: Json
          ats?: Json | null
          calculated_at?: string
          cv_file_name?: string | null
          cv_id?: string | null
          id?: string
          matches?: Json
          profile_source: string
          scoring_version: string
          skill_gaps?: Json | null
          student_id: string
          version_no: number
          weights?: Json
        }
        Update: {
          action_plan?: Json
          ats?: Json | null
          calculated_at?: string
          cv_file_name?: string | null
          cv_id?: string | null
          id?: string
          matches?: Json
          profile_source?: string
          scoring_version?: string
          skill_gaps?: Json | null
          student_id?: string
          version_no?: number
          weights?: Json
        }
        Relationships: [
          {
            foreignKeyName: "career_analysis_versions_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      career_counselling_events: {
        Row: {
          actor_id: string | null
          created_at: string
          cv_id: string | null
          details: Json
          duration_ms: number | null
          event_type: string
          id: string
          student_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          cv_id?: string | null
          details?: Json
          duration_ms?: number | null
          event_type: string
          id?: string
          student_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          cv_id?: string | null
          details?: Json
          duration_ms?: number | null
          event_type?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "career_counselling_events_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      career_matching_weight_profiles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          profile_mode: string
          updated_at: string
          weights: Json
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          profile_mode: string
          updated_at?: string
          weights: Json
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          profile_mode?: string
          updated_at?: string
          weights?: Json
        }
        Relationships: []
      }
      career_role_matches: {
        Row: {
          calculated_at: string
          career_role_id: string
          certification_score: number
          coursework_score: number
          cv_id: string | null
          experience_score: number
          fit_score: number
          hard_skill_score: number
          id: string
          job_readiness_score: number
          matched_evidence: Json
          missing_requirements: Json
          preference_score: number
          programme_score: number
          scoring_version: string
          skill_breakdown: Json
          soft_skill_score: number
          student_id: string
          tools_score: number
        }
        Insert: {
          calculated_at?: string
          career_role_id: string
          certification_score?: number
          coursework_score?: number
          cv_id?: string | null
          experience_score?: number
          fit_score?: number
          hard_skill_score?: number
          id?: string
          job_readiness_score?: number
          matched_evidence?: Json
          missing_requirements?: Json
          preference_score?: number
          programme_score?: number
          scoring_version?: string
          skill_breakdown?: Json
          soft_skill_score?: number
          student_id: string
          tools_score?: number
        }
        Update: {
          calculated_at?: string
          career_role_id?: string
          certification_score?: number
          coursework_score?: number
          cv_id?: string | null
          experience_score?: number
          fit_score?: number
          hard_skill_score?: number
          id?: string
          job_readiness_score?: number
          matched_evidence?: Json
          missing_requirements?: Json
          preference_score?: number
          programme_score?: number
          scoring_version?: string
          skill_breakdown?: Json
          soft_skill_score?: number
          student_id?: string
          tools_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "career_role_matches_career_role_id_fkey"
            columns: ["career_role_id"]
            isOneToOne: false
            referencedRelation: "career_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "career_role_matches_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      career_roles: {
        Row: {
          active: boolean
          ats_keywords: string[]
          career_family: string
          certifications: string[]
          created_at: string
          description_ar: string
          description_en: string
          experience_expectations: string
          id: string
          industry_sectors: string[]
          portfolio_expectations: string
          preferred_courses: string[]
          preferred_hard_skills: string[]
          preferred_tools: string[]
          required_hard_skills: string[]
          required_soft_skills: string[]
          role_code: string
          suitable_programmes: string[]
          title_ar: string
          title_en: string
          typical_entry_level: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          ats_keywords?: string[]
          career_family: string
          certifications?: string[]
          created_at?: string
          description_ar?: string
          description_en?: string
          experience_expectations?: string
          id?: string
          industry_sectors?: string[]
          portfolio_expectations?: string
          preferred_courses?: string[]
          preferred_hard_skills?: string[]
          preferred_tools?: string[]
          required_hard_skills?: string[]
          required_soft_skills?: string[]
          role_code: string
          suitable_programmes?: string[]
          title_ar: string
          title_en: string
          typical_entry_level?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          ats_keywords?: string[]
          career_family?: string
          certifications?: string[]
          created_at?: string
          description_ar?: string
          description_en?: string
          experience_expectations?: string
          id?: string
          industry_sectors?: string[]
          portfolio_expectations?: string
          preferred_courses?: string[]
          preferred_hard_skills?: string[]
          preferred_tools?: string[]
          required_hard_skills?: string[]
          required_soft_skills?: string[]
          role_code?: string
          suitable_programmes?: string[]
          title_ar?: string
          title_en?: string
          typical_entry_level?: string
          updated_at?: string
        }
        Relationships: []
      }
      case_access_restrictions: {
        Row: {
          allowed_profile_ids: Json
          allowed_roles: Json
          case_id: string
          created_at: string
          created_by: string | null
          id: string
          reason: string | null
          restriction_type: string
        }
        Insert: {
          allowed_profile_ids?: Json
          allowed_roles?: Json
          case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          restriction_type: string
        }
        Update: {
          allowed_profile_ids?: Json
          allowed_roles?: Json
          case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          reason?: string | null
          restriction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_access_restrictions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_restrictions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_access_restrictions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_assignments: {
        Row: {
          assigned_by: string | null
          assigned_to: string | null
          case_id: string
          created_at: string
          id: string
          service_unit_id: string | null
        }
        Insert: {
          assigned_by?: string | null
          assigned_to?: string | null
          case_id: string
          created_at?: string
          id?: string
          service_unit_id?: string | null
        }
        Update: {
          assigned_by?: string | null
          assigned_to?: string | null
          case_id?: string
          created_at?: string
          id?: string
          service_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_assignments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_assignments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_assignments_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      case_automation_state: {
        Row: {
          ai_confidence: number | null
          ai_status: string
          attention_category: string | null
          attention_reason_ar: string | null
          attention_reason_en: string | null
          automation_paused: boolean
          case_id: string
          created_at: string
          last_automated_at: string | null
          next_action_ar: string | null
          next_action_at: string | null
          next_action_en: string | null
          next_action_key: string | null
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          reminders_sent: number
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_status?: string
          attention_category?: string | null
          attention_reason_ar?: string | null
          attention_reason_en?: string | null
          automation_paused?: boolean
          case_id: string
          created_at?: string
          last_automated_at?: string | null
          next_action_ar?: string | null
          next_action_at?: string | null
          next_action_en?: string | null
          next_action_key?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          reminders_sent?: number
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_status?: string
          attention_category?: string | null
          attention_reason_ar?: string | null
          attention_reason_en?: string | null
          automation_paused?: boolean
          case_id?: string
          created_at?: string
          last_automated_at?: string | null
          next_action_ar?: string | null
          next_action_at?: string | null
          next_action_en?: string | null
          next_action_key?: string | null
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          reminders_sent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_automation_state_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_automation_state_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_automation_state_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_categories: {
        Row: {
          case_type: Database["public"]["Enums"]["case_type"]
          code: string
          created_at: string
          default_unit_id: string | null
          id: string
          is_active: boolean
          is_sensitive: boolean
          name_ar: string
          name_en: string
        }
        Insert: {
          case_type?: Database["public"]["Enums"]["case_type"]
          code: string
          created_at?: string
          default_unit_id?: string | null
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          name_ar: string
          name_en: string
        }
        Update: {
          case_type?: Database["public"]["Enums"]["case_type"]
          code?: string
          created_at?: string
          default_unit_id?: string | null
          id?: string
          is_active?: boolean
          is_sensitive?: boolean
          name_ar?: string
          name_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_categories_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      case_comments: {
        Row: {
          author_id: string
          body: string
          case_id: string
          created_at: string
          id: string
          is_info_request: boolean
          is_internal: boolean
        }
        Insert: {
          author_id: string
          body: string
          case_id: string
          created_at?: string
          id?: string
          is_info_request?: boolean
          is_internal?: boolean
        }
        Update: {
          author_id?: string
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          is_info_request?: boolean
          is_internal?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "case_comments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_comments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_conflicts_of_interest: {
        Row: {
          case_id: string
          conflict_type: string
          created_at: string
          description: string | null
          id: string
          profile_id: string | null
          recusal_status: string
        }
        Insert: {
          case_id: string
          conflict_type: string
          created_at?: string
          description?: string | null
          id?: string
          profile_id?: string | null
          recusal_status?: string
        }
        Update: {
          case_id?: string
          conflict_type?: string
          created_at?: string
          description?: string | null
          id?: string
          profile_id?: string | null
          recusal_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_conflicts_of_interest_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_conflicts_of_interest_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_conflicts_of_interest_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_escalations: {
        Row: {
          case_id: string
          created_at: string
          id: string
          raised_by: string
          reason: string
          resolved_at: string | null
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          raised_by: string
          reason: string
          resolved_at?: string | null
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          raised_by?: string
          reason?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_escalations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_escalations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_evidence: {
        Row: {
          case_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          case_id: string
          created_at?: string
          file_name: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          case_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_feedback: {
        Row: {
          case_id: string
          comments: string | null
          communication_rating: number | null
          effort_score: number | null
          fairness_rating: number | null
          id: string
          issue_fully_resolved: boolean | null
          overall_satisfaction: number | null
          resolution_quality_rating: number | null
          response_speed_rating: number | null
          student_id: string
          submitted_at: string
        }
        Insert: {
          case_id: string
          comments?: string | null
          communication_rating?: number | null
          effort_score?: number | null
          fairness_rating?: number | null
          id?: string
          issue_fully_resolved?: boolean | null
          overall_satisfaction?: number | null
          resolution_quality_rating?: number | null
          response_speed_rating?: number | null
          student_id: string
          submitted_at?: string
        }
        Update: {
          case_id?: string
          comments?: string | null
          communication_rating?: number | null
          effort_score?: number | null
          fairness_rating?: number | null
          id?: string
          issue_fully_resolved?: boolean | null
          overall_satisfaction?: number | null
          resolution_quality_rating?: number | null
          response_speed_rating?: number | null
          student_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_feedback_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_handovers: {
        Row: {
          actions_taken: Json
          attachments: Json
          case_id: string
          conversation_context: Json
          created_at: string
          id: string
          interaction_type: string | null
          priority: string | null
          recommended_action: string | null
          service_unit_id: string | null
          student_email: string | null
          student_name: string | null
          student_number: string | null
          summary_ar: string | null
          summary_en: string | null
          unit_name_ar: string | null
          unit_name_en: string | null
          unresolved_issue: string | null
          updated_at: string
          verified_data: Json
        }
        Insert: {
          actions_taken?: Json
          attachments?: Json
          case_id: string
          conversation_context?: Json
          created_at?: string
          id?: string
          interaction_type?: string | null
          priority?: string | null
          recommended_action?: string | null
          service_unit_id?: string | null
          student_email?: string | null
          student_name?: string | null
          student_number?: string | null
          summary_ar?: string | null
          summary_en?: string | null
          unit_name_ar?: string | null
          unit_name_en?: string | null
          unresolved_issue?: string | null
          updated_at?: string
          verified_data?: Json
        }
        Update: {
          actions_taken?: Json
          attachments?: Json
          case_id?: string
          conversation_context?: Json
          created_at?: string
          id?: string
          interaction_type?: string | null
          priority?: string | null
          recommended_action?: string | null
          service_unit_id?: string | null
          student_email?: string | null
          student_name?: string | null
          student_number?: string | null
          summary_ar?: string | null
          summary_en?: string | null
          unit_name_ar?: string | null
          unit_name_en?: string | null
          unresolved_issue?: string | null
          updated_at?: string
          verified_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "case_handovers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_handovers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_handovers_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      case_information_requests: {
        Row: {
          accepted_file_types: string[] | null
          case_id: string
          created_at: string
          due_at: string | null
          id: string
          information_required: string
          pauses_sla: boolean
          reason: string | null
          reminder_days: number
          requested_by: string | null
          responded_at: string | null
          response_note: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_file_types?: string[] | null
          case_id: string
          created_at?: string
          due_at?: string | null
          id?: string
          information_required: string
          pauses_sla?: boolean
          reason?: string | null
          reminder_days?: number
          requested_by?: string | null
          responded_at?: string | null
          response_note?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_file_types?: string[] | null
          case_id?: string
          created_at?: string
          due_at?: string | null
          id?: string
          information_required?: string
          pauses_sla?: boolean
          reason?: string | null
          reminder_days?: number
          requested_by?: string | null
          responded_at?: string | null
          response_note?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_information_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_information_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_information_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_monitor_grants: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          scope: string
          unit_ids: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          scope?: string
          unit_ids?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          scope?: string
          unit_ids?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      case_oversight_actions: {
        Row: {
          action_type: string
          actor_id: string
          case_id: string
          created_at: string
          id: string
          new_owner_id: string | null
          new_unit_id: string | null
          previous_owner_id: string | null
          previous_unit_id: string | null
          reason: string | null
          sla_treatment: string | null
        }
        Insert: {
          action_type: string
          actor_id: string
          case_id: string
          created_at?: string
          id?: string
          new_owner_id?: string | null
          new_unit_id?: string | null
          previous_owner_id?: string | null
          previous_unit_id?: string | null
          reason?: string | null
          sla_treatment?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string
          case_id?: string
          created_at?: string
          id?: string
          new_owner_id?: string | null
          new_unit_id?: string | null
          previous_owner_id?: string | null
          previous_unit_id?: string | null
          reason?: string | null
          sla_treatment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_oversight_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_oversight_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_reopen_requests: {
        Row: {
          case_id: string
          created_at: string
          decision_reason: string | null
          id: string
          kind: string
          new_evidence: string | null
          original_decided_at: string | null
          original_outcome_ar: string | null
          original_outcome_en: string | null
          original_status: string | null
          reason: string
          requested_outcome: string | null
          review_decision: string
          reviewed_at: string | null
          reviewed_by: string | null
          student_id: string
        }
        Insert: {
          case_id: string
          created_at?: string
          decision_reason?: string | null
          id?: string
          kind?: string
          new_evidence?: string | null
          original_decided_at?: string | null
          original_outcome_ar?: string | null
          original_outcome_en?: string | null
          original_status?: string | null
          reason: string
          requested_outcome?: string | null
          review_decision?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          student_id: string
        }
        Update: {
          case_id?: string
          created_at?: string
          decision_reason?: string | null
          id?: string
          kind?: string
          new_evidence?: string | null
          original_decided_at?: string | null
          original_outcome_ar?: string | null
          original_outcome_en?: string | null
          original_status?: string | null
          reason?: string
          requested_outcome?: string | null
          review_decision?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_reopen_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_reopen_requests_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_reopen_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_reopen_requests_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_resolutions: {
        Row: {
          action_taken: string | null
          approved_at: string | null
          approved_by: string | null
          case_id: string
          compensation_or_remedy: string | null
          created_at: string
          finalized_at: string | null
          id: string
          manager_approval_required: boolean
          policy_basis: string | null
          prepared_by: string | null
          proposed_to_student_at: string | null
          resolution_summary_ar: string | null
          resolution_summary_en: string
          resolution_type: string
          student_response: string | null
          student_response_at: string | null
          student_response_comment: string | null
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          approved_at?: string | null
          approved_by?: string | null
          case_id: string
          compensation_or_remedy?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          manager_approval_required?: boolean
          policy_basis?: string | null
          prepared_by?: string | null
          proposed_to_student_at?: string | null
          resolution_summary_ar?: string | null
          resolution_summary_en: string
          resolution_type: string
          student_response?: string | null
          student_response_at?: string | null
          student_response_comment?: string | null
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          approved_at?: string | null
          approved_by?: string | null
          case_id?: string
          compensation_or_remedy?: string | null
          created_at?: string
          finalized_at?: string | null
          id?: string
          manager_approval_required?: boolean
          policy_basis?: string | null
          prepared_by?: string | null
          proposed_to_student_at?: string | null
          resolution_summary_ar?: string | null
          resolution_summary_en?: string
          resolution_type?: string
          student_response?: string | null
          student_response_at?: string | null
          student_response_comment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_resolutions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_resolutions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_resolutions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_resolutions_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      case_responsibility_history: {
        Row: {
          actor: string
          actor_user_id: string | null
          case_id: string
          created_at: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          reason: string | null
          service_unit_id: string | null
          started_at: string
        }
        Insert: {
          actor: string
          actor_user_id?: string | null
          case_id: string
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          reason?: string | null
          service_unit_id?: string | null
          started_at?: string
        }
        Update: {
          actor?: string
          actor_user_id?: string | null
          case_id?: string
          created_at?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          reason?: string | null
          service_unit_id?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_responsibility_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_responsibility_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_responsibility_history_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      case_routing_feedback: {
        Row: {
          case_id: string
          corrected_unit_id: string | null
          created_at: string
          id: string
          original_service_code: string | null
          original_topic: string | null
          original_unit_id: string | null
          reason: string
          reported_by: string
        }
        Insert: {
          case_id: string
          corrected_unit_id?: string | null
          created_at?: string
          id?: string
          original_service_code?: string | null
          original_topic?: string | null
          original_unit_id?: string | null
          reason: string
          reported_by: string
        }
        Update: {
          case_id?: string
          corrected_unit_id?: string | null
          created_at?: string
          id?: string
          original_service_code?: string | null
          original_topic?: string | null
          original_unit_id?: string | null
          reason?: string
          reported_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_routing_feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_routing_feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_routing_feedback_corrected_unit_id_fkey"
            columns: ["corrected_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_routing_feedback_original_unit_id_fkey"
            columns: ["original_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      case_sla_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          action_taken: string | null
          case_id: string
          event_type: string
          id: string
          threshold_percentage: number | null
          triggered_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          action_taken?: string | null
          case_id: string
          event_type: string
          id?: string
          threshold_percentage?: number | null
          triggered_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          action_taken?: string | null
          case_id?: string
          event_type?: string
          id?: string
          threshold_percentage?: number | null
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_sla_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_sla_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_sla_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_status_history: {
        Row: {
          case_id: string
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["case_status"] | null
          id: string
          note: string | null
          to_status: Database["public"]["Enums"]["case_status"]
        }
        Insert: {
          case_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["case_status"] | null
          id?: string
          note?: string | null
          to_status: Database["public"]["Enums"]["case_status"]
        }
        Update: {
          case_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["case_status"] | null
          id?: string
          note?: string | null
          to_status?: Database["public"]["Enums"]["case_status"]
        }
        Relationships: [
          {
            foreignKeyName: "case_status_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_status_history_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          acknowledged_at: string | null
          ai_confidence: number | null
          ai_recommended_action: string | null
          ai_summary: string | null
          alert_location: string | null
          alert_type: string | null
          anonymous_requested: boolean
          assigned_at: string | null
          assigned_to: string | null
          assignment_method: string | null
          attention_reason: string | null
          automation_level: string | null
          case_number: string
          case_type: Database["public"]["Enums"]["case_type"]
          category_id: string | null
          closed_at: string | null
          closure_reason: string | null
          confidentiality: string
          created_at: string
          current_responsible_actor: string
          deleted_at: string | null
          deletion_type: string | null
          description: string
          desired_resolution: string | null
          due_at: string | null
          entry_channel: string
          escalated_at: string | null
          escalation_level: number
          expected_resolution_date: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          human_review_required: boolean
          id: string
          incident_date: string | null
          is_demo: boolean
          is_sensitive: boolean
          language: Database["public"]["Enums"]["lang_code"]
          last_activity_at: string
          linked_suggestion_id: string | null
          meeting_at: string | null
          meeting_location: string | null
          meeting_mode: string | null
          meeting_note: string | null
          meeting_set_at: string | null
          meeting_set_by: string | null
          needs_assignment_attention: boolean
          next_action_ar: string | null
          next_action_en: string | null
          outcome_ar: string | null
          outcome_en: string | null
          priority_score: number
          related_conversation_id: string | null
          related_internship_assignment_id: string | null
          reopened_count: number
          resolution_communicated_at: string | null
          resolution_due_at: string | null
          resolved_at: string | null
          response_state: string | null
          responsible_since: string | null
          root_cause_code: string | null
          routing_confidence: number | null
          routing_reason_ar: string | null
          routing_reason_en: string | null
          routing_service_code: string | null
          routing_topic: string | null
          satisfaction_rating: number | null
          sensitivity_level: string
          service_unit_id: string | null
          severity: string
          shortcut_hint: string | null
          sla_paused_at: string | null
          sla_paused_minutes: number
          sla_state: string
          status: Database["public"]["Enums"]["case_status"]
          structured_details: Json | null
          student_hidden_at: string | null
          student_hidden_by: string | null
          student_id: string
          title: string
          university_service_id: string | null
          unread_student_message: boolean
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
          workload_at_assignment: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          ai_confidence?: number | null
          ai_recommended_action?: string | null
          ai_summary?: string | null
          alert_location?: string | null
          alert_type?: string | null
          anonymous_requested?: boolean
          assigned_at?: string | null
          assigned_to?: string | null
          assignment_method?: string | null
          attention_reason?: string | null
          automation_level?: string | null
          case_number: string
          case_type?: Database["public"]["Enums"]["case_type"]
          category_id?: string | null
          closed_at?: string | null
          closure_reason?: string | null
          confidentiality?: string
          created_at?: string
          current_responsible_actor?: string
          deleted_at?: string | null
          deletion_type?: string | null
          description: string
          desired_resolution?: string | null
          due_at?: string | null
          entry_channel?: string
          escalated_at?: string | null
          escalation_level?: number
          expected_resolution_date?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          human_review_required?: boolean
          id?: string
          incident_date?: string | null
          is_demo?: boolean
          is_sensitive?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          last_activity_at?: string
          linked_suggestion_id?: string | null
          meeting_at?: string | null
          meeting_location?: string | null
          meeting_mode?: string | null
          meeting_note?: string | null
          meeting_set_at?: string | null
          meeting_set_by?: string | null
          needs_assignment_attention?: boolean
          next_action_ar?: string | null
          next_action_en?: string | null
          outcome_ar?: string | null
          outcome_en?: string | null
          priority_score?: number
          related_conversation_id?: string | null
          related_internship_assignment_id?: string | null
          reopened_count?: number
          resolution_communicated_at?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          response_state?: string | null
          responsible_since?: string | null
          root_cause_code?: string | null
          routing_confidence?: number | null
          routing_reason_ar?: string | null
          routing_reason_en?: string | null
          routing_service_code?: string | null
          routing_topic?: string | null
          satisfaction_rating?: number | null
          sensitivity_level?: string
          service_unit_id?: string | null
          severity?: string
          shortcut_hint?: string | null
          sla_paused_at?: string | null
          sla_paused_minutes?: number
          sla_state?: string
          status?: Database["public"]["Enums"]["case_status"]
          structured_details?: Json | null
          student_hidden_at?: string | null
          student_hidden_by?: string | null
          student_id: string
          title: string
          university_service_id?: string | null
          unread_student_message?: boolean
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          workload_at_assignment?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          ai_confidence?: number | null
          ai_recommended_action?: string | null
          ai_summary?: string | null
          alert_location?: string | null
          alert_type?: string | null
          anonymous_requested?: boolean
          assigned_at?: string | null
          assigned_to?: string | null
          assignment_method?: string | null
          attention_reason?: string | null
          automation_level?: string | null
          case_number?: string
          case_type?: Database["public"]["Enums"]["case_type"]
          category_id?: string | null
          closed_at?: string | null
          closure_reason?: string | null
          confidentiality?: string
          created_at?: string
          current_responsible_actor?: string
          deleted_at?: string | null
          deletion_type?: string | null
          description?: string
          desired_resolution?: string | null
          due_at?: string | null
          entry_channel?: string
          escalated_at?: string | null
          escalation_level?: number
          expected_resolution_date?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          human_review_required?: boolean
          id?: string
          incident_date?: string | null
          is_demo?: boolean
          is_sensitive?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          last_activity_at?: string
          linked_suggestion_id?: string | null
          meeting_at?: string | null
          meeting_location?: string | null
          meeting_mode?: string | null
          meeting_note?: string | null
          meeting_set_at?: string | null
          meeting_set_by?: string | null
          needs_assignment_attention?: boolean
          next_action_ar?: string | null
          next_action_en?: string | null
          outcome_ar?: string | null
          outcome_en?: string | null
          priority_score?: number
          related_conversation_id?: string | null
          related_internship_assignment_id?: string | null
          reopened_count?: number
          resolution_communicated_at?: string | null
          resolution_due_at?: string | null
          resolved_at?: string | null
          response_state?: string | null
          responsible_since?: string | null
          root_cause_code?: string | null
          routing_confidence?: number | null
          routing_reason_ar?: string | null
          routing_reason_en?: string | null
          routing_service_code?: string | null
          routing_topic?: string | null
          satisfaction_rating?: number | null
          sensitivity_level?: string
          service_unit_id?: string | null
          severity?: string
          shortcut_hint?: string | null
          sla_paused_at?: string | null
          sla_paused_minutes?: number
          sla_state?: string
          status?: Database["public"]["Enums"]["case_status"]
          structured_details?: Json | null
          student_hidden_at?: string | null
          student_hidden_by?: string | null
          student_id?: string
          title?: string
          university_service_id?: string | null
          unread_student_message?: boolean
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          workload_at_assignment?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "case_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_linked_suggestion_id_fkey"
            columns: ["linked_suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_related_conversation_id_fkey"
            columns: ["related_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_related_internship_assignment_id_fkey"
            columns: ["related_internship_assignment_id"]
            isOneToOne: false
            referencedRelation: "internship_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_action_completions: {
        Row: {
          action_key: string
          action_type: string
          conversation_id: string | null
          created_at: string
          created_case_id: string | null
          id: string
          idempotency_key: string
          message_id: string | null
          receipt: Json | null
          reference_number: string | null
          result_message: string | null
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          action_key: string
          action_type: string
          conversation_id?: string | null
          created_at?: string
          created_case_id?: string | null
          id?: string
          idempotency_key: string
          message_id?: string | null
          receipt?: Json | null
          reference_number?: string | null
          result_message?: string | null
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          action_key?: string
          action_type?: string
          conversation_id?: string | null
          created_at?: string
          created_case_id?: string | null
          id?: string
          idempotency_key?: string
          message_id?: string | null
          receipt?: Json | null
          reference_number?: string | null
          result_message?: string | null
          student_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      citations: {
        Row: {
          citation_url: string | null
          confidence: string
          created_at: string
          document_id: string | null
          document_version: string | null
          effective_date: string | null
          id: string
          message_id: string | null
          owning_unit: string | null
          source_title: string
          user_id: string
        }
        Insert: {
          citation_url?: string | null
          confidence?: string
          created_at?: string
          document_id?: string | null
          document_version?: string | null
          effective_date?: string | null
          id?: string
          message_id?: string | null
          owning_unit?: string | null
          source_title: string
          user_id: string
        }
        Update: {
          citation_url?: string | null
          confidence?: string
          created_at?: string
          document_id?: string | null
          document_version?: string | null
          effective_date?: string | null
          id?: string
          message_id?: string | null
          owning_unit?: string | null
          source_title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "citations_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "citations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      colleges: {
        Row: {
          campus_id: string | null
          code: string
          contact_email: string | null
          created_at: string
          dean_name: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          university_id: string
          updated_at: string
        }
        Insert: {
          campus_id?: string | null
          code: string
          contact_email?: string | null
          created_at?: string
          dean_name?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          university_id: string
          updated_at?: string
        }
        Update: {
          campus_id?: string | null
          code?: string
          contact_email?: string | null
          created_at?: string
          dean_name?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          university_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "colleges_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colleges_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          consent_type: string
          created_at: string
          granted: boolean
          id: string
          user_id: string
          version: string
        }
        Insert: {
          consent_type: string
          created_at?: string
          granted?: boolean
          id?: string
          user_id: string
          version?: string
        }
        Update: {
          consent_type?: string
          created_at?: string
          granted?: boolean
          id?: string
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      conversation_state: {
        Row: {
          active_intents: Json
          conversation_id: string
          created_at: string
          current_service_id: string | null
          current_service_unit_id: string | null
          extracted_entities: Json
          human_handoff_state: string
          id: string
          language: Database["public"]["Enums"]["lang_code"]
          last_agent_type: string | null
          pending_action_request_id: string | null
          pending_confirmation_payload: Json | null
          pending_confirmation_type: string | null
          pending_questions: Json
          related_case_id: string | null
          related_suggestion_id: string | null
          summary: string | null
          turn_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active_intents?: Json
          conversation_id: string
          created_at?: string
          current_service_id?: string | null
          current_service_unit_id?: string | null
          extracted_entities?: Json
          human_handoff_state?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          last_agent_type?: string | null
          pending_action_request_id?: string | null
          pending_confirmation_payload?: Json | null
          pending_confirmation_type?: string | null
          pending_questions?: Json
          related_case_id?: string | null
          related_suggestion_id?: string | null
          summary?: string | null
          turn_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active_intents?: Json
          conversation_id?: string
          created_at?: string
          current_service_id?: string | null
          current_service_unit_id?: string | null
          extracted_entities?: Json
          human_handoff_state?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          last_agent_type?: string | null
          pending_action_request_id?: string | null
          pending_confirmation_payload?: Json | null
          pending_confirmation_type?: string | null
          pending_questions?: Json
          related_case_id?: string | null
          related_suggestion_id?: string | null
          summary?: string | null
          turn_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_state_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_current_service_id_fkey"
            columns: ["current_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_current_service_unit_id_fkey"
            columns: ["current_service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_pending_action_request_id_fkey"
            columns: ["pending_action_request_id"]
            isOneToOne: false
            referencedRelation: "action_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_state_related_suggestion_id_fkey"
            columns: ["related_suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          conversation_status: string
          created_at: string
          id: string
          language: Database["public"]["Enums"]["lang_code"]
          related_case_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          conversation_status?: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          related_case_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          conversation_status?: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"]
          related_case_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      course_prerequisites: {
        Row: {
          course_id: string
          created_at: string
          id: string
          is_active: boolean
          minimum_grade: string
          prerequisite_course_id: string
          prerequisite_type: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          minimum_grade?: string
          prerequisite_course_id: string
          prerequisite_type?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          minimum_grade?: string
          prerequisite_course_id?: string
          prerequisite_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_prerequisites_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_prerequisites_prerequisite_course_id_fkey"
            columns: ["prerequisite_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_sections: {
        Row: {
          academic_term_id: string
          capacity: number
          course_id: string
          created_at: string
          enrolled_count: number
          id: string
          instructor_name: string | null
          meeting_schedule: string | null
          room: string | null
          section_number: string
          status: string
          updated_at: string
        }
        Insert: {
          academic_term_id: string
          capacity?: number
          course_id: string
          created_at?: string
          enrolled_count?: number
          id?: string
          instructor_name?: string | null
          meeting_schedule?: string | null
          room?: string | null
          section_number: string
          status?: string
          updated_at?: string
        }
        Update: {
          academic_term_id?: string
          capacity?: number
          course_id?: string
          created_at?: string
          enrolled_count?: number
          id?: string
          instructor_name?: string | null
          meeting_schedule?: string | null
          room?: string | null
          section_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_sections_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_sections_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string
          course_level: number
          created_at: string
          credit_hours: number
          department_id: string | null
          description_ar: string | null
          description_en: string | null
          id: string
          is_active: boolean
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          code: string
          course_level?: number
          created_at?: string
          credit_hours?: number
          department_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          code?: string
          course_level?: number
          created_at?: string
          credit_hours?: number
          department_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_ats_scores: {
        Row: {
          achievement_score: number
          breakdown: Json
          calculated_at: string
          clarity_score: number
          completeness_score: number
          contact_score: number
          cv_id: string
          cv_version: string | null
          details: Json
          education_score: number
          experience_project_score: number
          id: string
          improvements: Json
          keyword_score: number
          overall_score: number
          parsing_confidence: string | null
          recommended_keywords: Json
          role_code: string | null
          score_kind: string
          scoring_version: string
          skills_score: number
          strengths: Json
          structure_score: number
          student_id: string
          target_role_id: string | null
          weights_version: string
        }
        Insert: {
          achievement_score?: number
          breakdown?: Json
          calculated_at?: string
          clarity_score?: number
          completeness_score?: number
          contact_score?: number
          cv_id: string
          cv_version?: string | null
          details?: Json
          education_score?: number
          experience_project_score?: number
          id?: string
          improvements?: Json
          keyword_score?: number
          overall_score?: number
          parsing_confidence?: string | null
          recommended_keywords?: Json
          role_code?: string | null
          score_kind?: string
          scoring_version?: string
          skills_score?: number
          strengths?: Json
          structure_score?: number
          student_id: string
          target_role_id?: string | null
          weights_version?: string
        }
        Update: {
          achievement_score?: number
          breakdown?: Json
          calculated_at?: string
          clarity_score?: number
          completeness_score?: number
          contact_score?: number
          cv_id?: string
          cv_version?: string | null
          details?: Json
          education_score?: number
          experience_project_score?: number
          id?: string
          improvements?: Json
          keyword_score?: number
          overall_score?: number
          parsing_confidence?: string | null
          recommended_keywords?: Json
          role_code?: string | null
          score_kind?: string
          scoring_version?: string
          skills_score?: number
          strengths?: Json
          structure_score?: number
          student_id?: string
          target_role_id?: string | null
          weights_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "cv_ats_scores_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cv_ats_scores_target_role_id_fkey"
            columns: ["target_role_id"]
            isOneToOne: false
            referencedRelation: "career_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      cv_upload_scans: {
        Row: {
          created_at: string
          cv_id: string | null
          file_name: string
          findings: Json
          id: string
          mime_type: string
          quarantine_path: string | null
          scan_status: string
          scanner: string
          sha256: string | null
          size_bytes: number
          student_id: string
          verdict: string | null
        }
        Insert: {
          created_at?: string
          cv_id?: string | null
          file_name: string
          findings?: Json
          id?: string
          mime_type: string
          quarantine_path?: string | null
          scan_status?: string
          scanner?: string
          sha256?: string | null
          size_bytes?: number
          student_id: string
          verdict?: string | null
        }
        Update: {
          created_at?: string
          cv_id?: string | null
          file_name?: string
          findings?: Json
          id?: string
          mime_type?: string
          quarantine_path?: string | null
          scan_status?: string
          scanner?: string
          sha256?: string | null
          size_bytes?: number
          student_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cv_upload_scans_cv_id_fkey"
            columns: ["cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      data_authority_rules: {
        Row: {
          cache_allowed: boolean
          conflict_behavior: string
          created_at: string
          data_domain: string
          id: string
          is_active: boolean
          maximum_staleness_minutes: number | null
          owner_unit_id: string | null
          primary_source_id: string | null
          primary_source_type: string
          secondary_source_id: string | null
          secondary_source_type: string | null
          updated_at: string
        }
        Insert: {
          cache_allowed?: boolean
          conflict_behavior?: string
          created_at?: string
          data_domain: string
          id?: string
          is_active?: boolean
          maximum_staleness_minutes?: number | null
          owner_unit_id?: string | null
          primary_source_id?: string | null
          primary_source_type: string
          secondary_source_id?: string | null
          secondary_source_type?: string | null
          updated_at?: string
        }
        Update: {
          cache_allowed?: boolean
          conflict_behavior?: string
          created_at?: string
          data_domain?: string
          id?: string
          is_active?: boolean
          maximum_staleness_minutes?: number | null
          owner_unit_id?: string | null
          primary_source_id?: string | null
          primary_source_type?: string
          secondary_source_id?: string | null
          secondary_source_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_authority_rules_owner_unit_id_fkey"
            columns: ["owner_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          chair_name: string | null
          code: string
          college_id: string | null
          contact_email: string | null
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          updated_at: string
        }
        Insert: {
          chair_name?: string | null
          code: string
          college_id?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          updated_at?: string
        }
        Update: {
          chair_name?: string | null
          code?: string
          college_id?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
        ]
      }
      detected_intents: {
        Row: {
          action_requested: boolean
          category: string | null
          confidence: number | null
          created_at: string
          id: string
          intent: string
          language: Database["public"]["Enums"]["lang_code"] | null
          message_id: string
          required_unit_id: string | null
          requires_auth: boolean
          requires_human: boolean
          requires_student_data: boolean
          sentiment: string | null
          urgency: Database["public"]["Enums"]["urgency_level"]
          user_id: string
        }
        Insert: {
          action_requested?: boolean
          category?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          intent: string
          language?: Database["public"]["Enums"]["lang_code"] | null
          message_id: string
          required_unit_id?: string | null
          requires_auth?: boolean
          requires_human?: boolean
          requires_student_data?: boolean
          sentiment?: string | null
          urgency?: Database["public"]["Enums"]["urgency_level"]
          user_id: string
        }
        Update: {
          action_requested?: boolean
          category?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          intent?: string
          language?: Database["public"]["Enums"]["lang_code"] | null
          message_id?: string
          required_unit_id?: string | null
          requires_auth?: boolean
          requires_human?: boolean
          requires_student_data?: boolean
          sentiment?: string | null
          urgency?: Database["public"]["Enums"]["urgency_level"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "detected_intents_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detected_intents_required_unit_id_fkey"
            columns: ["required_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_json: Json | null
          id: string
          is_active: boolean
          metadata: Json
          page_number: number | null
          quality_score: number | null
          search_vector: unknown
          section_path: string | null
          section_title: string | null
          source_locator: string | null
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_json?: Json | null
          id?: string
          is_active?: boolean
          metadata?: Json
          page_number?: number | null
          quality_score?: number | null
          search_vector?: unknown
          section_path?: string | null
          section_title?: string | null
          source_locator?: string | null
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_json?: Json | null
          id?: string
          is_active?: boolean
          metadata?: Json
          page_number?: number | null
          quality_score?: number | null
          search_vector?: unknown
          section_path?: string | null
          section_title?: string | null
          source_locator?: string | null
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_deletion_records: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          deleted_at: string
          deletion_type: string
          document_id: string
          document_type: string
          id: string
          reference_number: string
          student_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          created_at: string
          deleted_at?: string
          deletion_type: string
          document_id: string
          document_type: string
          id?: string
          reference_number: string
          student_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          deleted_at?: string
          deletion_type?: string
          document_id?: string
          document_type?: string
          id?: string
          reference_number?: string
          student_id?: string
        }
        Relationships: []
      }
      document_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          created_at: string
          details: Json
          document_id: string | null
          event_type: string
          id: string
          reference_number: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          document_id?: string | null
          event_type: string
          id?: string
          reference_number?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          details?: Json
          document_id?: string | null
          event_type?: string
          id?: string
          reference_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_events_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "issued_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_retention_policies: {
        Row: {
          document_type: string
          label_ar: string | null
          label_en: string | null
          retention_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          document_type: string
          label_ar?: string | null
          label_en?: string | null
          retention_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          document_type?: string
          label_ar?: string | null
          label_en?: string | null
          retention_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          body_template: string
          created_at: string
          disclaimer: string | null
          document_type: string
          effective_date: string
          footer_text: string | null
          header_text: string | null
          id: string
          is_active: boolean
          language: string
          optional_fields: Json
          required_fields: Json
          signatory_block: string | null
          status: string
          title: string
          updated_at: string
          validity_days: number | null
          version: number
        }
        Insert: {
          body_template: string
          created_at?: string
          disclaimer?: string | null
          document_type: string
          effective_date?: string
          footer_text?: string | null
          header_text?: string | null
          id?: string
          is_active?: boolean
          language: string
          optional_fields?: Json
          required_fields?: Json
          signatory_block?: string | null
          status?: string
          title: string
          updated_at?: string
          validity_days?: number | null
          version?: number
        }
        Update: {
          body_template?: string
          created_at?: string
          disclaimer?: string | null
          document_type?: string
          effective_date?: string
          footer_text?: string | null
          header_text?: string | null
          id?: string
          is_active?: boolean
          language?: string
          optional_fields?: Json
          required_fields?: Json
          signatory_block?: string | null
          status?: string
          title?: string
          updated_at?: string
          validity_days?: number | null
          version?: number
        }
        Relationships: []
      }
      document_verification_attempts: {
        Row: {
          client_hash: string
          created_at: string
          id: string
          outcome: string
          token_hash: string
        }
        Insert: {
          client_hash: string
          created_at?: string
          id?: string
          outcome: string
          token_hash: string
        }
        Update: {
          client_hash?: string
          created_at?: string
          id?: string
          outcome?: string
          token_hash?: string
        }
        Relationships: []
      }
      document_verification_tombstones: {
        Row: {
          reason: string
          reference_number: string | null
          retired_at: string
          token_hash: string
        }
        Insert: {
          reason?: string
          reference_number?: string | null
          retired_at?: string
          token_hash: string
        }
        Update: {
          reason?: string
          reference_number?: string | null
          retired_at?: string
          token_hash?: string
        }
        Relationships: []
      }
      document_versions: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          notes: string | null
          storage_path: string | null
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          notes?: string | null
          storage_path?: string | null
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          notes?: string | null
          storage_path?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_ar: string
          body_en: string
          created_at: string
          cta_label_ar: string | null
          cta_label_en: string | null
          effective_from: string
          effective_to: string | null
          enabled: boolean
          id: string
          name_ar: string
          name_en: string
          severity: Database["public"]["Enums"]["notification_severity"]
          subject_ar: string
          subject_en: string
          template_code: string
          updated_at: string
          version: number
        }
        Insert: {
          body_ar: string
          body_en: string
          created_at?: string
          cta_label_ar?: string | null
          cta_label_en?: string | null
          effective_from?: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          name_ar: string
          name_en: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          subject_ar: string
          subject_en: string
          template_code: string
          updated_at?: string
          version?: number
        }
        Update: {
          body_ar?: string
          body_en?: string
          created_at?: string
          cta_label_ar?: string | null
          cta_label_en?: string | null
          effective_from?: string
          effective_to?: string | null
          enabled?: boolean
          id?: string
          name_ar?: string
          name_en?: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          subject_ar?: string
          subject_en?: string
          template_code?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      emergency_broadcasts: {
        Row: {
          action_url: string | null
          approved_at: string | null
          approved_by: string | null
          audience: string
          audience_config: Json
          created_at: string
          created_by: string
          delivered_count: number
          failed_count: number
          id: string
          language_policy: string
          message_ar: string
          message_en: string
          recipient_count: number
          requires_approval: boolean
          sent_at: string | null
          status: string
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          action_url?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience?: string
          audience_config?: Json
          created_at?: string
          created_by: string
          delivered_count?: number
          failed_count?: number
          id?: string
          language_policy?: string
          message_ar: string
          message_en: string
          recipient_count?: number
          requires_approval?: boolean
          sent_at?: string | null
          status?: string
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          action_url?: string | null
          approved_at?: string | null
          approved_by?: string | null
          audience?: string
          audience_config?: Json
          created_at?: string
          created_by?: string
          delivered_count?: number
          failed_count?: number
          id?: string
          language_policy?: string
          message_ar?: string
          message_en?: string
          recipient_count?: number
          requires_approval?: boolean
          sent_at?: string | null
          status?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      emergency_contacts: {
        Row: {
          category_ar: string | null
          category_en: string | null
          code: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          email: string | null
          emergency_number: string | null
          emergency_type_ar: string | null
          emergency_type_en: string | null
          id: string
          is_active: boolean
          keywords: string[]
          kind: string
          label_ar: string
          label_en: string
          mobile_number: string | null
          notes_ar: string | null
          notes_en: string | null
          phone: string | null
          priority: number
          responsible_unit_ar: string | null
          responsible_unit_en: string | null
          sort_order: number
          updated_at: string
          url: string | null
        }
        Insert: {
          category_ar?: string | null
          category_en?: string | null
          code: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          email?: string | null
          emergency_number?: string | null
          emergency_type_ar?: string | null
          emergency_type_en?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          kind?: string
          label_ar: string
          label_en: string
          mobile_number?: string | null
          notes_ar?: string | null
          notes_en?: string | null
          phone?: string | null
          priority?: number
          responsible_unit_ar?: string | null
          responsible_unit_en?: string | null
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Update: {
          category_ar?: string | null
          category_en?: string | null
          code?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          email?: string | null
          emergency_number?: string | null
          emergency_type_ar?: string | null
          emergency_type_en?: string | null
          id?: string
          is_active?: boolean
          keywords?: string[]
          kind?: string
          label_ar?: string
          label_en?: string
          mobile_number?: string | null
          notes_ar?: string | null
          notes_en?: string | null
          phone?: string | null
          priority?: number
          responsible_unit_ar?: string | null
          responsible_unit_en?: string | null
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      escalation_actions: {
        Row: {
          acknowledged_at: string | null
          case_id: string
          escalation_level: number
          escalation_policy_id: string | null
          id: string
          new_assignee_id: string | null
          previous_assignee_id: string | null
          previous_unit_id: string | null
          reason: string | null
          resolved_at: string | null
          target_unit_id: string | null
          triggered_at: string
          triggered_by: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          case_id: string
          escalation_level?: number
          escalation_policy_id?: string | null
          id?: string
          new_assignee_id?: string | null
          previous_assignee_id?: string | null
          previous_unit_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          target_unit_id?: string | null
          triggered_at?: string
          triggered_by?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          case_id?: string
          escalation_level?: number
          escalation_policy_id?: string | null
          id?: string
          new_assignee_id?: string | null
          previous_assignee_id?: string | null
          previous_unit_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          target_unit_id?: string | null
          triggered_at?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_escalation_policy_id_fkey"
            columns: ["escalation_policy_id"]
            isOneToOne: false
            referencedRelation: "escalation_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_new_assignee_id_fkey"
            columns: ["new_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_previous_assignee_id_fkey"
            columns: ["previous_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_previous_unit_id_fkey"
            columns: ["previous_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_target_unit_id_fkey"
            columns: ["target_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_actions_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation_policies: {
        Row: {
          case_type: Database["public"]["Enums"]["case_type"] | null
          created_at: string
          escalation_level: number
          id: string
          is_active: boolean
          notify_student: boolean
          requires_reason: boolean
          service_unit_id: string | null
          target_role: Database["public"]["Enums"]["app_role"] | null
          target_unit_id: string | null
          trigger_type: string
          trigger_value: string | null
          updated_at: string
        }
        Insert: {
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          escalation_level?: number
          id?: string
          is_active?: boolean
          notify_student?: boolean
          requires_reason?: boolean
          service_unit_id?: string | null
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_unit_id?: string | null
          trigger_type: string
          trigger_value?: string | null
          updated_at?: string
        }
        Update: {
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          escalation_level?: number
          id?: string
          is_active?: boolean
          notify_student?: boolean
          requires_reason?: boolean
          service_unit_id?: string | null
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_unit_id?: string | null
          trigger_type?: string
          trigger_value?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "escalation_policies_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_policies_target_unit_id_fkey"
            columns: ["target_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_equivalence_groups: {
        Row: {
          created_at: string
          description: string
          expected_core_outcome: Json
          group_code: string
          id: string
          is_active: boolean
          tolerance_rules: Json
        }
        Insert: {
          created_at?: string
          description: string
          expected_core_outcome?: Json
          group_code: string
          id?: string
          is_active?: boolean
          tolerance_rules?: Json
        }
        Update: {
          created_at?: string
          description?: string
          expected_core_outcome?: Json
          group_code?: string
          id?: string
          is_active?: boolean
          tolerance_rules?: Json
        }
        Relationships: []
      }
      evaluation_equivalence_items: {
        Row: {
          created_at: string
          expected_intent: string | null
          expected_tools: Json
          group_id: string
          id: string
          input_message: string
          language: Database["public"]["Enums"]["lang_code"]
          student_id: string | null
        }
        Insert: {
          created_at?: string
          expected_intent?: string | null
          expected_tools?: Json
          group_id: string
          id?: string
          input_message: string
          language?: Database["public"]["Enums"]["lang_code"]
          student_id?: string | null
        }
        Update: {
          created_at?: string
          expected_intent?: string | null
          expected_tools?: Json
          group_id?: string
          id?: string
          input_message?: string
          language?: Database["public"]["Enums"]["lang_code"]
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_equivalence_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "evaluation_equivalence_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_equivalence_items_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_runs: {
        Row: {
          action_safety_score: number | null
          actual_outcome_type: string | null
          answer_text: string | null
          batch_id: string | null
          citation_accuracy_score: number | null
          created_at: string
          detected_intents: Json
          factual_accuracy_score: number | null
          id: string
          language_quality_score: number | null
          latency_ms: number | null
          model_name: string | null
          overall_score: number | null
          passed: boolean
          prompt_version: string | null
          run_by: string | null
          scenario_id: string
          tool_selection_score: number | null
          tools_used: Json
        }
        Insert: {
          action_safety_score?: number | null
          actual_outcome_type?: string | null
          answer_text?: string | null
          batch_id?: string | null
          citation_accuracy_score?: number | null
          created_at?: string
          detected_intents?: Json
          factual_accuracy_score?: number | null
          id?: string
          language_quality_score?: number | null
          latency_ms?: number | null
          model_name?: string | null
          overall_score?: number | null
          passed?: boolean
          prompt_version?: string | null
          run_by?: string | null
          scenario_id: string
          tool_selection_score?: number | null
          tools_used?: Json
        }
        Update: {
          action_safety_score?: number | null
          actual_outcome_type?: string | null
          answer_text?: string | null
          batch_id?: string | null
          citation_accuracy_score?: number | null
          created_at?: string
          detected_intents?: Json
          factual_accuracy_score?: number | null
          id?: string
          language_quality_score?: number | null
          latency_ms?: number | null
          model_name?: string | null
          overall_score?: number | null
          passed?: boolean
          prompt_version?: string | null
          run_by?: string | null
          scenario_id?: string
          tool_selection_score?: number | null
          tools_used?: Json
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_runs_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "evaluation_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_scenarios: {
        Row: {
          category: string
          created_at: string
          difficulty: string | null
          expected_human_handoff: boolean
          expected_intents: Json
          expected_outcome_type: string
          expected_risk_level: Database["public"]["Enums"]["action_risk"]
          expected_service_unit_id: string | null
          expected_tools: Json
          id: string
          input_message: string
          is_active: boolean
          language: Database["public"]["Enums"]["lang_code"]
          latency_class: string | null
          notes: string | null
          risk_tag: string | null
          scenario_code: string
          service_tag: string | null
          student_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          difficulty?: string | null
          expected_human_handoff?: boolean
          expected_intents?: Json
          expected_outcome_type?: string
          expected_risk_level?: Database["public"]["Enums"]["action_risk"]
          expected_service_unit_id?: string | null
          expected_tools?: Json
          id?: string
          input_message: string
          is_active?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          latency_class?: string | null
          notes?: string | null
          risk_tag?: string | null
          scenario_code: string
          service_tag?: string | null
          student_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          difficulty?: string | null
          expected_human_handoff?: boolean
          expected_intents?: Json
          expected_outcome_type?: string
          expected_risk_level?: Database["public"]["Enums"]["action_risk"]
          expected_service_unit_id?: string | null
          expected_tools?: Json
          id?: string
          input_message?: string
          is_active?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          latency_class?: string | null
          notes?: string | null
          risk_tag?: string | null
          scenario_code?: string
          service_tag?: string | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_scenarios_expected_service_unit_id_fkey"
            columns: ["expected_service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_events: {
        Row: {
          case_id: string | null
          code: string
          context: Json
          conversation_id: string | null
          created_at: string
          detail: string | null
          escalated: boolean
          id: string
          is_test: boolean
          recovered: boolean
          recovery_action: string | null
          resolved_at: string | null
          scenario: string | null
          severity: string
          student_message: string | null
          trace_id: string | null
          user_id: string | null
        }
        Insert: {
          case_id?: string | null
          code: string
          context?: Json
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          escalated?: boolean
          id?: string
          is_test?: boolean
          recovered?: boolean
          recovery_action?: string | null
          resolved_at?: string | null
          scenario?: string | null
          severity?: string
          student_message?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Update: {
          case_id?: string | null
          code?: string
          context?: Json
          conversation_id?: string | null
          created_at?: string
          detail?: string | null
          escalated?: boolean
          id?: string
          is_test?: boolean
          recovered?: boolean
          recovery_action?: string | null
          resolved_at?: string | null
          scenario?: string | null
          severity?: string
          student_message?: string | null
          trace_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      faq_items: {
        Row: {
          answer_ar: string
          answer_en: string
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          document_id: string | null
          effective_date: string
          expiry_date: string | null
          id: string
          is_active: boolean
          knowledge_domain: string | null
          priority: number
          question_ar: string
          question_en: string
          review_date: string | null
          search_keywords: Json
          search_vector: unknown
          service_unit_id: string | null
          source_section: string | null
          university_service_id: string | null
          updated_at: string
        }
        Insert: {
          answer_ar: string
          answer_en: string
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          document_id?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          knowledge_domain?: string | null
          priority?: number
          question_ar: string
          question_en: string
          review_date?: string | null
          search_keywords?: Json
          search_vector?: unknown
          service_unit_id?: string | null
          source_section?: string | null
          university_service_id?: string | null
          updated_at?: string
        }
        Update: {
          answer_ar?: string
          answer_en?: string
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          document_id?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          knowledge_domain?: string | null
          priority?: number
          question_ar?: string
          question_en?: string
          review_date?: string | null
          search_keywords?: Json
          search_vector?: unknown
          service_unit_id?: string | null
          source_section?: string | null
          university_service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faq_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faq_items_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faq_items_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          case_id: string | null
          comment: string | null
          created_at: string
          id: string
          message_id: string | null
          rating: number | null
          user_id: string
          was_helpful: boolean | null
        }
        Insert: {
          case_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          rating?: number | null
          user_id: string
          was_helpful?: boolean | null
        }
        Update: {
          case_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          message_id?: string | null
          rating?: number | null
          user_id?: string
          was_helpful?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_policies: {
        Row: {
          case_type: Database["public"]["Enums"]["case_type"] | null
          created_at: string
          entity_type: string
          escalation_after_hours: number | null
          final_reminder_after_hours: number | null
          first_reminder_after_hours: number
          id: string
          is_active: boolean
          maximum_reminders: number
          notify_manager: boolean
          notify_owner: boolean
          notify_student: boolean
          second_reminder_after_hours: number | null
          service_unit_id: string | null
          updated_at: string
          waiting_state: string
        }
        Insert: {
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          entity_type?: string
          escalation_after_hours?: number | null
          final_reminder_after_hours?: number | null
          first_reminder_after_hours?: number
          id?: string
          is_active?: boolean
          maximum_reminders?: number
          notify_manager?: boolean
          notify_owner?: boolean
          notify_student?: boolean
          second_reminder_after_hours?: number | null
          service_unit_id?: string | null
          updated_at?: string
          waiting_state: string
        }
        Update: {
          case_type?: Database["public"]["Enums"]["case_type"] | null
          created_at?: string
          entity_type?: string
          escalation_after_hours?: number | null
          final_reminder_after_hours?: number | null
          first_reminder_after_hours?: number
          id?: string
          is_active?: boolean
          maximum_reminders?: number
          notify_manager?: boolean
          notify_owner?: boolean
          notify_student?: boolean
          second_reminder_after_hours?: number | null
          service_unit_id?: string | null
          updated_at?: string
          waiting_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_policies_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      grounding_checks: {
        Row: {
          agent_run_id: string | null
          citation_count: number
          claim_count: number
          created_at: string
          failure_details: Json
          grounding_score: number
          id: string
          invalid_citation_count: number
          passed: boolean
          student_data_claim_count: number
          supported_claim_count: number
          unsupported_claim_count: number
          verified_student_data_claim_count: number
        }
        Insert: {
          agent_run_id?: string | null
          citation_count?: number
          claim_count?: number
          created_at?: string
          failure_details?: Json
          grounding_score?: number
          id?: string
          invalid_citation_count?: number
          passed?: boolean
          student_data_claim_count?: number
          supported_claim_count?: number
          unsupported_claim_count?: number
          verified_student_data_claim_count?: number
        }
        Update: {
          agent_run_id?: string | null
          citation_count?: number
          claim_count?: number
          created_at?: string
          failure_details?: Json
          grounding_score?: number
          id?: string
          invalid_citation_count?: number
          passed?: boolean
          student_data_claim_count?: number
          supported_claim_count?: number
          unsupported_claim_count?: number
          verified_student_data_claim_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "grounding_checks_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hostel_rooms: {
        Row: {
          accessibility_enabled: boolean
          available_beds: number
          capacity: number
          created_at: string
          floor: number | null
          hostel_id: string
          id: string
          is_demo_record: boolean
          occupied_beds: number
          room_number: string
          room_type: string
          status: string
          updated_at: string
        }
        Insert: {
          accessibility_enabled?: boolean
          available_beds?: number
          capacity?: number
          created_at?: string
          floor?: number | null
          hostel_id: string
          id?: string
          is_demo_record?: boolean
          occupied_beds?: number
          room_number: string
          room_type: string
          status?: string
          updated_at?: string
        }
        Update: {
          accessibility_enabled?: boolean
          available_beds?: number
          capacity?: number
          created_at?: string
          floor?: number | null
          hostel_id?: string
          id?: string
          is_demo_record?: boolean
          occupied_beds?: number
          room_number?: string
          room_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hostel_rooms_hostel_id_fkey"
            columns: ["hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
        ]
      }
      hostels: {
        Row: {
          available_capacity: number
          campus_id: string | null
          code: string
          created_at: string
          current_occupancy: number
          eligibility_notes_ar: string | null
          eligibility_notes_en: string | null
          facilities: Json
          gender_category: string
          id: string
          is_active: boolean
          is_demo_record: boolean
          location_ar: string | null
          location_en: string | null
          name_ar: string
          name_en: string
          room_types: Json
          total_capacity: number
          updated_at: string
        }
        Insert: {
          available_capacity?: number
          campus_id?: string | null
          code: string
          created_at?: string
          current_occupancy?: number
          eligibility_notes_ar?: string | null
          eligibility_notes_en?: string | null
          facilities?: Json
          gender_category?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar: string
          name_en: string
          room_types?: Json
          total_capacity?: number
          updated_at?: string
        }
        Update: {
          available_capacity?: number
          campus_id?: string | null
          code?: string
          created_at?: string
          current_occupancy?: number
          eligibility_notes_ar?: string | null
          eligibility_notes_en?: string | null
          facilities?: Json
          gender_category?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar?: string
          name_en?: string
          room_types?: Json
          total_capacity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hostels_campus_id_fkey"
            columns: ["campus_id"]
            isOneToOne: false
            referencedRelation: "campuses"
            referencedColumns: ["id"]
          },
        ]
      }
      housing_allocations: {
        Row: {
          allocated_at: string
          allocated_by_agent_run_id: string | null
          allocated_by_type: string
          allocation_number: string
          allocation_status: string
          bed_label: string | null
          created_at: string
          hostel_id: string
          housing_application_id: string
          id: string
          move_in_date: string | null
          move_out_date: string | null
          override_reason: string | null
          reviewed_at: string | null
          reviewed_by_owner_id: string | null
          room_id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          allocated_at?: string
          allocated_by_agent_run_id?: string | null
          allocated_by_type?: string
          allocation_number: string
          allocation_status?: string
          bed_label?: string | null
          created_at?: string
          hostel_id: string
          housing_application_id: string
          id?: string
          move_in_date?: string | null
          move_out_date?: string | null
          override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_owner_id?: string | null
          room_id: string
          student_id: string
          updated_at?: string
        }
        Update: {
          allocated_at?: string
          allocated_by_agent_run_id?: string | null
          allocated_by_type?: string
          allocation_number?: string
          allocation_status?: string
          bed_label?: string | null
          created_at?: string
          hostel_id?: string
          housing_application_id?: string
          id?: string
          move_in_date?: string | null
          move_out_date?: string | null
          override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by_owner_id?: string | null
          room_id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housing_allocations_hostel_id_fkey"
            columns: ["hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_allocations_housing_application_id_fkey"
            columns: ["housing_application_id"]
            isOneToOne: false
            referencedRelation: "housing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_allocations_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "hostel_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      housing_applications: {
        Row: {
          agent_run_id: string | null
          application_number: string
          application_status: string
          assigned_owner_id: string | null
          created_at: string
          eligibility_check_result: Json
          eligibility_status: string
          final_hostel_id: string | null
          final_room_id: string | null
          human_review_reason: string | null
          id: string
          language: string
          preferred_hostel_id: string | null
          preferred_room_type: string | null
          proposed_hostel_id: string | null
          proposed_room_id: string | null
          registered_at: string | null
          requires_human_review: boolean
          service_id: string | null
          student_confirmed_at: string | null
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          application_number: string
          application_status?: string
          assigned_owner_id?: string | null
          created_at?: string
          eligibility_check_result?: Json
          eligibility_status?: string
          final_hostel_id?: string | null
          final_room_id?: string | null
          human_review_reason?: string | null
          id?: string
          language?: string
          preferred_hostel_id?: string | null
          preferred_room_type?: string | null
          proposed_hostel_id?: string | null
          proposed_room_id?: string | null
          registered_at?: string | null
          requires_human_review?: boolean
          service_id?: string | null
          student_confirmed_at?: string | null
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          application_number?: string
          application_status?: string
          assigned_owner_id?: string | null
          created_at?: string
          eligibility_check_result?: Json
          eligibility_status?: string
          final_hostel_id?: string | null
          final_room_id?: string | null
          human_review_reason?: string | null
          id?: string
          language?: string
          preferred_hostel_id?: string | null
          preferred_room_type?: string | null
          proposed_hostel_id?: string | null
          proposed_room_id?: string | null
          registered_at?: string | null
          requires_human_review?: boolean
          service_id?: string | null
          student_confirmed_at?: string | null
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "housing_applications_final_hostel_id_fkey"
            columns: ["final_hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_applications_final_room_id_fkey"
            columns: ["final_room_id"]
            isOneToOne: false
            referencedRelation: "hostel_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_applications_preferred_hostel_id_fkey"
            columns: ["preferred_hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_applications_proposed_hostel_id_fkey"
            columns: ["proposed_hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_applications_proposed_room_id_fkey"
            columns: ["proposed_room_id"]
            isOneToOne: false
            referencedRelation: "hostel_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_applications_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      housing_eligibility_rules: {
        Row: {
          condition_type: string
          condition_value: Json
          created_at: string
          description_ar: string
          description_en: string
          effective_date: string
          expiry_date: string | null
          id: string
          is_active: boolean
          mandatory: boolean
          priority: number
          rule_name: string
          updated_at: string
        }
        Insert: {
          condition_type: string
          condition_value?: Json
          created_at?: string
          description_ar: string
          description_en: string
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          mandatory?: boolean
          priority?: number
          rule_name: string
          updated_at?: string
        }
        Update: {
          condition_type?: string
          condition_value?: Json
          created_at?: string
          description_ar?: string
          description_en?: string
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          mandatory?: boolean
          priority?: number
          rule_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      housing_waitlist: {
        Row: {
          accepted_at: string | null
          created_at: string
          housing_application_id: string | null
          id: string
          joined_at: string
          offer_expires_at: string | null
          offered_at: string | null
          preferred_hostel_id: string | null
          preferred_room_type: string | null
          priority_score: number
          student_id: string
          updated_at: string
          waitlist_status: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          housing_application_id?: string | null
          id?: string
          joined_at?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          preferred_hostel_id?: string | null
          preferred_room_type?: string | null
          priority_score?: number
          student_id: string
          updated_at?: string
          waitlist_status?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          housing_application_id?: string | null
          id?: string
          joined_at?: string
          offer_expires_at?: string | null
          offered_at?: string | null
          preferred_hostel_id?: string | null
          preferred_room_type?: string | null
          priority_score?: number
          student_id?: string
          updated_at?: string
          waitlist_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "housing_waitlist_housing_application_id_fkey"
            columns: ["housing_application_id"]
            isOneToOne: false
            referencedRelation: "housing_applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "housing_waitlist_preferred_hostel_id_fkey"
            columns: ["preferred_hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connectors: {
        Row: {
          authentication_type: string
          base_url: string | null
          business_owner: string | null
          cache_policy: Json
          connector_name: string
          connector_type: string
          created_at: string
          created_by: string | null
          credential_configured: boolean
          credential_expires_at: string | null
          credential_last_tested_at: string | null
          credential_secret_name: string | null
          data_classification: string
          display_name_ar: string | null
          display_name_en: string | null
          environment: string
          health_status: string
          id: string
          is_active: boolean
          is_demo: boolean
          last_health_check_at: string | null
          owner_unit_id: string | null
          rate_limit_policy: Json
          read_enabled: boolean
          retry_policy: Json
          source_system: string
          technical_owner: string | null
          timeout_ms: number
          updated_at: string
          write_enabled: boolean
        }
        Insert: {
          authentication_type?: string
          base_url?: string | null
          business_owner?: string | null
          cache_policy?: Json
          connector_name: string
          connector_type?: string
          created_at?: string
          created_by?: string | null
          credential_configured?: boolean
          credential_expires_at?: string | null
          credential_last_tested_at?: string | null
          credential_secret_name?: string | null
          data_classification?: string
          display_name_ar?: string | null
          display_name_en?: string | null
          environment?: string
          health_status?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          last_health_check_at?: string | null
          owner_unit_id?: string | null
          rate_limit_policy?: Json
          read_enabled?: boolean
          retry_policy?: Json
          source_system: string
          technical_owner?: string | null
          timeout_ms?: number
          updated_at?: string
          write_enabled?: boolean
        }
        Update: {
          authentication_type?: string
          base_url?: string | null
          business_owner?: string | null
          cache_policy?: Json
          connector_name?: string
          connector_type?: string
          created_at?: string
          created_by?: string | null
          credential_configured?: boolean
          credential_expires_at?: string | null
          credential_last_tested_at?: string | null
          credential_secret_name?: string | null
          data_classification?: string
          display_name_ar?: string | null
          display_name_en?: string | null
          environment?: string
          health_status?: string
          id?: string
          is_active?: boolean
          is_demo?: boolean
          last_health_check_at?: string | null
          owner_unit_id?: string | null
          rate_limit_policy?: Json
          read_enabled?: boolean
          retry_policy?: Json
          source_system?: string
          technical_owner?: string | null
          timeout_ms?: number
          updated_at?: string
          write_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integration_connectors_owner_unit_id_fkey"
            columns: ["owner_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_field_mappings: {
        Row: {
          connector_id: string
          created_at: string
          data_type: string
          default_value: string | null
          external_field: string
          id: string
          internal_field: string
          masking_rule: string | null
          required: boolean
          sensitive: boolean
          tool_id: string | null
          transformation_rule: string | null
          updated_at: string
          validation_rule: string | null
        }
        Insert: {
          connector_id: string
          created_at?: string
          data_type?: string
          default_value?: string | null
          external_field: string
          id?: string
          internal_field: string
          masking_rule?: string | null
          required?: boolean
          sensitive?: boolean
          tool_id?: string | null
          transformation_rule?: string | null
          updated_at?: string
          validation_rule?: string | null
        }
        Update: {
          connector_id?: string
          created_at?: string
          data_type?: string
          default_value?: string | null
          external_field?: string
          id?: string
          internal_field?: string
          masking_rule?: string | null
          required?: boolean
          sensitive?: boolean
          tool_id?: string | null
          transformation_rule?: string | null
          updated_at?: string
          validation_rule?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_field_mappings_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_field_mappings_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "integration_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_health_events: {
        Row: {
          connector_id: string
          detected_at: string
          error_code: string | null
          error_message: string | null
          health_status: string
          id: string
          latency_ms: number | null
          resolved_at: string | null
        }
        Insert: {
          connector_id: string
          detected_at?: string
          error_code?: string | null
          error_message?: string | null
          health_status: string
          id?: string
          latency_ms?: number | null
          resolved_at?: string | null
        }
        Update: {
          connector_id?: string
          detected_at?: string
          error_code?: string | null
          error_message?: string | null
          health_status?: string
          id?: string
          latency_ms?: number | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_health_events_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_schema_versions: {
        Row: {
          connector_id: string
          detected_at: string
          id: string
          is_current: boolean
          schema_hash: string
          schema_snapshot: Json
          tool_id: string | null
        }
        Insert: {
          connector_id: string
          detected_at?: string
          id?: string
          is_current?: boolean
          schema_hash: string
          schema_snapshot?: Json
          tool_id?: string | null
        }
        Update: {
          connector_id?: string
          detected_at?: string
          id?: string
          is_current?: boolean
          schema_hash?: string
          schema_snapshot?: Json
          tool_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_schema_versions_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_schema_versions_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "integration_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_test_runs: {
        Row: {
          authorization_valid: boolean | null
          completed_at: string | null
          connector_id: string
          error_code: string | null
          error_message: string | null
          id: string
          latency_ms: number | null
          response_preview: Json | null
          run_by: string | null
          schema_valid: boolean | null
          started_at: string
          status: string
          test_type: string
          tool_id: string | null
        }
        Insert: {
          authorization_valid?: boolean | null
          completed_at?: string | null
          connector_id: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          response_preview?: Json | null
          run_by?: string | null
          schema_valid?: boolean | null
          started_at?: string
          status?: string
          test_type?: string
          tool_id?: string | null
        }
        Update: {
          authorization_valid?: boolean | null
          completed_at?: string | null
          connector_id?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          latency_ms?: number | null
          response_preview?: Json | null
          run_by?: string | null
          schema_valid?: boolean | null
          started_at?: string
          status?: string
          test_type?: string
          tool_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_test_runs_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_test_runs_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "integration_tools"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_tools: {
        Row: {
          allowed_fields: Json
          allowed_roles: Json
          authentication_required: boolean
          blocked_fields: Json
          cache_ttl_seconds: number | null
          confirmation_required: boolean
          connector_id: string
          created_at: string
          description: string | null
          display_name_ar: string
          display_name_en: string
          enabled: boolean
          endpoint_path: string | null
          http_method: string | null
          human_approval_required: boolean
          id: string
          operation_type: string
          request_schema: Json
          response_schema: Json
          risk_level: string
          timeout_ms: number
          tool_name: string
          updated_at: string
        }
        Insert: {
          allowed_fields?: Json
          allowed_roles?: Json
          authentication_required?: boolean
          blocked_fields?: Json
          cache_ttl_seconds?: number | null
          confirmation_required?: boolean
          connector_id: string
          created_at?: string
          description?: string | null
          display_name_ar: string
          display_name_en: string
          enabled?: boolean
          endpoint_path?: string | null
          http_method?: string | null
          human_approval_required?: boolean
          id?: string
          operation_type?: string
          request_schema?: Json
          response_schema?: Json
          risk_level?: string
          timeout_ms?: number
          tool_name: string
          updated_at?: string
        }
        Update: {
          allowed_fields?: Json
          allowed_roles?: Json
          authentication_required?: boolean
          blocked_fields?: Json
          cache_ttl_seconds?: number | null
          confirmation_required?: boolean
          connector_id?: string
          created_at?: string
          description?: string | null
          display_name_ar?: string
          display_name_en?: string
          enabled?: boolean
          endpoint_path?: string | null
          http_method?: string | null
          human_approval_required?: boolean
          id?: string
          operation_type?: string
          request_schema?: Json
          response_schema?: Json
          risk_level?: string
          timeout_ms?: number
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_tools_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      intercollege_transfer_acknowledgements: {
        Row: {
          acknowledged_at: string
          capacity_accepted: boolean
          credit_loss_accepted: boolean
          final_transfer_confirmed: boolean
          financial_consequence_accepted: boolean
          gpa_change_accepted: boolean
          graduation_delay_accepted: boolean
          id: string
          one_transfer_rule_accepted: boolean
          student_id: string
          terms_version: string
          transfer_request_id: string
        }
        Insert: {
          acknowledged_at?: string
          capacity_accepted?: boolean
          credit_loss_accepted?: boolean
          final_transfer_confirmed?: boolean
          financial_consequence_accepted?: boolean
          gpa_change_accepted?: boolean
          graduation_delay_accepted?: boolean
          id?: string
          one_transfer_rule_accepted?: boolean
          student_id: string
          terms_version?: string
          transfer_request_id: string
        }
        Update: {
          acknowledged_at?: string
          capacity_accepted?: boolean
          credit_loss_accepted?: boolean
          final_transfer_confirmed?: boolean
          financial_consequence_accepted?: boolean
          gpa_change_accepted?: boolean
          graduation_delay_accepted?: boolean
          id?: string
          one_transfer_rule_accepted?: boolean
          student_id?: string
          terms_version?: string
          transfer_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intercollege_transfer_acknowledgements_transfer_request_id_fkey"
            columns: ["transfer_request_id"]
            isOneToOne: false
            referencedRelation: "intercollege_transfer_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      intercollege_transfer_course_impact: {
        Row: {
          counts_toward_degree: boolean
          course_title: string
          course_title_ar: string | null
          created_at: string
          credits_accepted: number
          grade: string | null
          id: string
          impact_reason_ar: string | null
          impact_reason_en: string | null
          impact_type: string
          original_credit_hours: number
          source_course_code: string
          source_course_id: string | null
          target_course_code: string | null
          target_course_id: string | null
          transfer_request_id: string
        }
        Insert: {
          counts_toward_degree?: boolean
          course_title: string
          course_title_ar?: string | null
          created_at?: string
          credits_accepted?: number
          grade?: string | null
          id?: string
          impact_reason_ar?: string | null
          impact_reason_en?: string | null
          impact_type: string
          original_credit_hours?: number
          source_course_code: string
          source_course_id?: string | null
          target_course_code?: string | null
          target_course_id?: string | null
          transfer_request_id: string
        }
        Update: {
          counts_toward_degree?: boolean
          course_title?: string
          course_title_ar?: string | null
          created_at?: string
          credits_accepted?: number
          grade?: string | null
          id?: string
          impact_reason_ar?: string | null
          impact_reason_en?: string | null
          impact_type?: string
          original_credit_hours?: number
          source_course_code?: string
          source_course_id?: string | null
          target_course_code?: string | null
          target_course_id?: string | null
          transfer_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intercollege_transfer_course_impact_source_course_id_fkey"
            columns: ["source_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_course_impact_target_course_id_fkey"
            columns: ["target_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_course_impact_transfer_request_id_fkey"
            columns: ["transfer_request_id"]
            isOneToOne: false
            referencedRelation: "intercollege_transfer_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      intercollege_transfer_requests: {
        Row: {
          acknowledgement_version: string | null
          additional_credits_required: number
          analysis_snapshot: Json
          analysis_version: string | null
          capacity_id: string | null
          completed_credits: number
          created_at: string
          current_gpa: number | null
          eligibility_reasons: Json
          eligibility_status: string
          equivalency_version: string | null
          estimated_delay_semesters: number
          executed_at: string | null
          expected_graduation_before: string | null
          human_review_reason: string | null
          id: string
          non_applicable_credits: number
          owner_notes: string | null
          projected_gpa: number | null
          projected_graduation_after: string | null
          requires_human_review: boolean
          retained_credits: number
          rule_version: string | null
          seats_after: number | null
          seats_before: number | null
          source_college_id: string | null
          source_programme_id: string | null
          student_confirmed_at: string | null
          student_id: string
          target_college_id: string | null
          target_programme_id: string | null
          transfer_count_before: number
          transfer_number: string | null
          transfer_status: string
          updated_at: string
        }
        Insert: {
          acknowledgement_version?: string | null
          additional_credits_required?: number
          analysis_snapshot?: Json
          analysis_version?: string | null
          capacity_id?: string | null
          completed_credits?: number
          created_at?: string
          current_gpa?: number | null
          eligibility_reasons?: Json
          eligibility_status?: string
          equivalency_version?: string | null
          estimated_delay_semesters?: number
          executed_at?: string | null
          expected_graduation_before?: string | null
          human_review_reason?: string | null
          id?: string
          non_applicable_credits?: number
          owner_notes?: string | null
          projected_gpa?: number | null
          projected_graduation_after?: string | null
          requires_human_review?: boolean
          retained_credits?: number
          rule_version?: string | null
          seats_after?: number | null
          seats_before?: number | null
          source_college_id?: string | null
          source_programme_id?: string | null
          student_confirmed_at?: string | null
          student_id: string
          target_college_id?: string | null
          target_programme_id?: string | null
          transfer_count_before?: number
          transfer_number?: string | null
          transfer_status?: string
          updated_at?: string
        }
        Update: {
          acknowledgement_version?: string | null
          additional_credits_required?: number
          analysis_snapshot?: Json
          analysis_version?: string | null
          capacity_id?: string | null
          completed_credits?: number
          created_at?: string
          current_gpa?: number | null
          eligibility_reasons?: Json
          eligibility_status?: string
          equivalency_version?: string | null
          estimated_delay_semesters?: number
          executed_at?: string | null
          expected_graduation_before?: string | null
          human_review_reason?: string | null
          id?: string
          non_applicable_credits?: number
          owner_notes?: string | null
          projected_gpa?: number | null
          projected_graduation_after?: string | null
          requires_human_review?: boolean
          retained_credits?: number
          rule_version?: string | null
          seats_after?: number | null
          seats_before?: number | null
          source_college_id?: string | null
          source_programme_id?: string | null
          student_confirmed_at?: string | null
          student_id?: string
          target_college_id?: string | null
          target_programme_id?: string | null
          transfer_count_before?: number
          transfer_number?: string | null
          transfer_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intercollege_transfer_requests_capacity_id_fkey"
            columns: ["capacity_id"]
            isOneToOne: false
            referencedRelation: "programme_transfer_capacity"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_requests_source_college_id_fkey"
            columns: ["source_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_requests_source_programme_id_fkey"
            columns: ["source_programme_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_requests_target_college_id_fkey"
            columns: ["target_college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intercollege_transfer_requests_target_programme_id_fkey"
            columns: ["target_programme_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_assignment_audit: {
        Row: {
          actor_id: string | null
          actor_type: string
          assignment_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
          student_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type?: string
          assignment_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
          student_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          assignment_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internship_assignment_audit_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "internship_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by_agent_run_id: string | null
          assigned_by_type: string
          assignment_number: string
          assignment_status: string
          course_registration_status: string
          created_at: string
          employer_acceptance_status: string
          final_allocation_at: string | null
          government_clearance_approved_at: string | null
          government_clearance_approved_by: string | null
          government_clearance_rejection_reason: string | null
          government_clearance_required: boolean
          government_clearance_status: string
          human_review_reason: string | null
          id: string
          internship_course_id: string | null
          internship_end_date: string | null
          internship_start_date: string | null
          match_explanation_id: string | null
          match_score: number | null
          opportunity_id: string
          organization_id: string
          owner_flagged: boolean
          owner_notes: string | null
          owner_review_status: string
          provisional_allocation_at: string | null
          related_case_id: string | null
          related_conversation_id: string | null
          requires_human_review: boolean
          seats_after: number | null
          seats_before: number | null
          service_owner_id: string | null
          student_confirmed_at: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by_agent_run_id?: string | null
          assigned_by_type?: string
          assignment_number: string
          assignment_status?: string
          course_registration_status?: string
          created_at?: string
          employer_acceptance_status?: string
          final_allocation_at?: string | null
          government_clearance_approved_at?: string | null
          government_clearance_approved_by?: string | null
          government_clearance_rejection_reason?: string | null
          government_clearance_required?: boolean
          government_clearance_status?: string
          human_review_reason?: string | null
          id?: string
          internship_course_id?: string | null
          internship_end_date?: string | null
          internship_start_date?: string | null
          match_explanation_id?: string | null
          match_score?: number | null
          opportunity_id: string
          organization_id: string
          owner_flagged?: boolean
          owner_notes?: string | null
          owner_review_status?: string
          provisional_allocation_at?: string | null
          related_case_id?: string | null
          related_conversation_id?: string | null
          requires_human_review?: boolean
          seats_after?: number | null
          seats_before?: number | null
          service_owner_id?: string | null
          student_confirmed_at?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by_agent_run_id?: string | null
          assigned_by_type?: string
          assignment_number?: string
          assignment_status?: string
          course_registration_status?: string
          created_at?: string
          employer_acceptance_status?: string
          final_allocation_at?: string | null
          government_clearance_approved_at?: string | null
          government_clearance_approved_by?: string | null
          government_clearance_rejection_reason?: string | null
          government_clearance_required?: boolean
          government_clearance_status?: string
          human_review_reason?: string | null
          id?: string
          internship_course_id?: string | null
          internship_end_date?: string | null
          internship_start_date?: string | null
          match_explanation_id?: string | null
          match_score?: number | null
          opportunity_id?: string
          organization_id?: string
          owner_flagged?: boolean
          owner_notes?: string | null
          owner_review_status?: string
          provisional_allocation_at?: string | null
          related_case_id?: string | null
          related_conversation_id?: string | null
          requires_human_review?: boolean
          seats_after?: number | null
          seats_before?: number | null
          service_owner_id?: string | null
          student_confirmed_at?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internship_assignments_internship_course_id_fkey"
            columns: ["internship_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_match_explanation_id_fkey"
            columns: ["match_explanation_id"]
            isOneToOne: false
            referencedRelation: "internship_match_explanations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "internship_opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "internship_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_assignments_related_conversation_id_fkey"
            columns: ["related_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_match_explanations: {
        Row: {
          calculated_at: string
          eligibility_passed: boolean
          exclusion_reason: string | null
          explanation_ar: string | null
          explanation_en: string | null
          gpa_score: number
          id: string
          location_score: number
          opportunity_id: string
          other_score: number
          preference_score: number
          programme_score: number
          skills_course_score: number
          student_id: string
          total_match_score: number
          weights_version: number | null
        }
        Insert: {
          calculated_at?: string
          eligibility_passed?: boolean
          exclusion_reason?: string | null
          explanation_ar?: string | null
          explanation_en?: string | null
          gpa_score?: number
          id?: string
          location_score?: number
          opportunity_id: string
          other_score?: number
          preference_score?: number
          programme_score?: number
          skills_course_score?: number
          student_id: string
          total_match_score?: number
          weights_version?: number | null
        }
        Update: {
          calculated_at?: string
          eligibility_passed?: boolean
          exclusion_reason?: string | null
          explanation_ar?: string | null
          explanation_en?: string | null
          gpa_score?: number
          id?: string
          location_score?: number
          opportunity_id?: string
          other_score?: number
          preference_score?: number
          programme_score?: number
          skills_course_score?: number
          student_id?: string
          total_match_score?: number
          weights_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "internship_match_explanations_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "internship_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_matching_weights: {
        Row: {
          approved_by: string | null
          created_at: string
          effective_from: string
          gpa_weight: number
          id: string
          is_active: boolean
          location_weight: number
          other_weight: number
          preference_weight: number
          programme_fit_weight: number
          skills_course_weight: number
          version: number
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          gpa_weight?: number
          id?: string
          is_active?: boolean
          location_weight?: number
          other_weight?: number
          preference_weight?: number
          programme_fit_weight?: number
          skills_course_weight?: number
          version?: number
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          effective_from?: string
          gpa_weight?: number
          id?: string
          is_active?: boolean
          location_weight?: number
          other_weight?: number
          preference_weight?: number
          programme_fit_weight?: number
          skills_course_weight?: number
          version?: number
        }
        Relationships: []
      }
      internship_opportunities: {
        Row: {
          active_status: string
          application_deadline: string | null
          assigned_seats: number
          available_seats: number | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          end_date: string
          field_category: string
          id: string
          internship_course_id: string | null
          is_demo_record: boolean
          location_city: string
          location_emirate: string
          minimum_completed_credits: number | null
          minimum_gpa: number | null
          opportunity_code: string
          organization_id: string
          preapproved_allocation: boolean
          preferred_courses: Json
          preferred_skills: Json
          required_courses: Json
          required_skills: Json
          requires_employer_review: boolean
          reserved_seats: number
          sector_preference: string | null
          start_date: string
          student_choice_allowed: boolean
          target_departments: Json
          target_programs: Json
          title_ar: string
          title_en: string
          total_seats: number
          updated_at: string
          work_mode: string
        }
        Insert: {
          active_status?: string
          application_deadline?: string | null
          assigned_seats?: number
          available_seats?: number | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          end_date: string
          field_category?: string
          id?: string
          internship_course_id?: string | null
          is_demo_record?: boolean
          location_city?: string
          location_emirate?: string
          minimum_completed_credits?: number | null
          minimum_gpa?: number | null
          opportunity_code: string
          organization_id: string
          preapproved_allocation?: boolean
          preferred_courses?: Json
          preferred_skills?: Json
          required_courses?: Json
          required_skills?: Json
          requires_employer_review?: boolean
          reserved_seats?: number
          sector_preference?: string | null
          start_date: string
          student_choice_allowed?: boolean
          target_departments?: Json
          target_programs?: Json
          title_ar: string
          title_en: string
          total_seats?: number
          updated_at?: string
          work_mode?: string
        }
        Update: {
          active_status?: string
          application_deadline?: string | null
          assigned_seats?: number
          available_seats?: number | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          end_date?: string
          field_category?: string
          id?: string
          internship_course_id?: string | null
          is_demo_record?: boolean
          location_city?: string
          location_emirate?: string
          minimum_completed_credits?: number | null
          minimum_gpa?: number | null
          opportunity_code?: string
          organization_id?: string
          preapproved_allocation?: boolean
          preferred_courses?: Json
          preferred_skills?: Json
          required_courses?: Json
          required_skills?: Json
          requires_employer_review?: boolean
          reserved_seats?: number
          sector_preference?: string | null
          start_date?: string
          student_choice_allowed?: boolean
          target_departments?: Json
          target_programs?: Json
          title_ar?: string
          title_en?: string
          total_seats?: number
          updated_at?: string
          work_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "internship_opportunities_internship_course_id_fkey"
            columns: ["internship_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internship_opportunities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "internship_organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_organizations: {
        Row: {
          active_from: string
          active_to: string | null
          approval_status: string
          city: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          emirate: string
          id: string
          is_active: boolean
          is_approved: boolean
          is_demo_record: boolean
          location_ar: string | null
          location_en: string | null
          name_ar: string
          name_en: string
          organization_code: string
          organization_type: string
          owner_unit_id: string | null
          sector_type: string
          updated_at: string
          website_demo_url: string | null
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          approval_status?: string
          city?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          emirate?: string
          id?: string
          is_active?: boolean
          is_approved?: boolean
          is_demo_record?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar: string
          name_en: string
          organization_code: string
          organization_type?: string
          owner_unit_id?: string | null
          sector_type?: string
          updated_at?: string
          website_demo_url?: string | null
        }
        Update: {
          active_from?: string
          active_to?: string | null
          approval_status?: string
          city?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          emirate?: string
          id?: string
          is_active?: boolean
          is_approved?: boolean
          is_demo_record?: boolean
          location_ar?: string | null
          location_en?: string | null
          name_ar?: string
          name_en?: string
          organization_code?: string
          organization_type?: string
          owner_unit_id?: string | null
          sector_type?: string
          updated_at?: string
          website_demo_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "internship_organizations_owner_unit_id_fkey"
            columns: ["owner_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      internship_waitlist: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          joined_at: string
          minimum_match_score: number
          offer_created_at: string | null
          offer_expires_at: string | null
          offered_opportunity_id: string | null
          preferred_fields: Json
          preferred_locations: Json
          priority_score: number
          status: string
          student_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          minimum_match_score?: number
          offer_created_at?: string | null
          offer_expires_at?: string | null
          offered_opportunity_id?: string | null
          preferred_fields?: Json
          preferred_locations?: Json
          priority_score?: number
          status?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          joined_at?: string
          minimum_match_score?: number
          offer_created_at?: string | null
          offer_expires_at?: string | null
          offered_opportunity_id?: string | null
          preferred_fields?: Json
          preferred_locations?: Json
          priority_score?: number
          status?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internship_waitlist_offered_opportunity_id_fkey"
            columns: ["offered_opportunity_id"]
            isOneToOne: false
            referencedRelation: "internship_opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      issued_documents: {
        Row: {
          certificate_id: string | null
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          digitally_signed: boolean
          document_hash: string | null
          document_status: string
          document_type: string
          document_version: number
          download_count: number
          expires_at: string | null
          file_path: string | null
          file_size_bytes: number | null
          generated_by_agent_run_id: string | null
          generated_by_type: string
          id: string
          included_fields: Json
          is_demo_document: boolean
          issued_at: string
          language: string
          message_id: string | null
          purpose: string
          reference_number: string
          retention_expires_at: string | null
          revocation_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          secure_verification_token: string
          signature_hash: string | null
          signed_at: string | null
          signing_provider: string | null
          snapshot: Json
          student_id: string
          superseded_by: string | null
          template_id: string | null
          template_version: string | null
          title_ar: string
          title_en: string
          updated_at: string
          verification_count: number
          verification_revoked_at: string | null
          verification_status: string
        }
        Insert: {
          certificate_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          digitally_signed?: boolean
          document_hash?: string | null
          document_status?: string
          document_type?: string
          document_version?: number
          download_count?: number
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          generated_by_agent_run_id?: string | null
          generated_by_type?: string
          id?: string
          included_fields?: Json
          is_demo_document?: boolean
          issued_at?: string
          language?: string
          message_id?: string | null
          purpose?: string
          reference_number: string
          retention_expires_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          secure_verification_token: string
          signature_hash?: string | null
          signed_at?: string | null
          signing_provider?: string | null
          snapshot?: Json
          student_id: string
          superseded_by?: string | null
          template_id?: string | null
          template_version?: string | null
          title_ar?: string
          title_en?: string
          updated_at?: string
          verification_count?: number
          verification_revoked_at?: string | null
          verification_status?: string
        }
        Update: {
          certificate_id?: string | null
          conversation_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          digitally_signed?: boolean
          document_hash?: string | null
          document_status?: string
          document_type?: string
          document_version?: number
          download_count?: number
          expires_at?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          generated_by_agent_run_id?: string | null
          generated_by_type?: string
          id?: string
          included_fields?: Json
          is_demo_document?: boolean
          issued_at?: string
          language?: string
          message_id?: string | null
          purpose?: string
          reference_number?: string
          retention_expires_at?: string | null
          revocation_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          secure_verification_token?: string
          signature_hash?: string | null
          signed_at?: string | null
          signing_provider?: string | null
          snapshot?: Json
          student_id?: string
          superseded_by?: string | null
          template_id?: string | null
          template_version?: string | null
          title_ar?: string
          title_en?: string
          updated_at?: string
          verification_count?: number
          verification_revoked_at?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "issued_documents_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "issued_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issued_documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_approval_requests: {
        Row: {
          approval_status: string
          assigned_approver_id: string | null
          assigned_approver_role: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          due_at: string | null
          entity_id: string
          entity_label: string | null
          entity_type: string
          id: string
          requested_at: string
          requested_by: string
          review_notes: string | null
          updated_at: string
        }
        Insert: {
          approval_status?: string
          assigned_approver_id?: string | null
          assigned_approver_role?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          entity_id: string
          entity_label?: string | null
          entity_type: string
          id?: string
          requested_at?: string
          requested_by: string
          review_notes?: string | null
          updated_at?: string
        }
        Update: {
          approval_status?: string
          assigned_approver_id?: string | null
          assigned_approver_role?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          due_at?: string | null
          entity_id?: string
          entity_label?: string | null
          entity_type?: string
          id?: string
          requested_at?: string
          requested_by?: string
          review_notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          id: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          id?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          id?: string
          summary?: string | null
        }
        Relationships: []
      }
      knowledge_conflicts: {
        Row: {
          affected_topic: string
          assigned_unit_id: string | null
          conflict_type: string
          conflicting_statement_one: string | null
          conflicting_statement_two: string | null
          detected_at: string
          id: string
          resolution_notes: string | null
          resolution_status: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_one_id: string | null
          source_one_type: string
          source_two_id: string | null
          source_two_type: string
        }
        Insert: {
          affected_topic: string
          assigned_unit_id?: string | null
          conflict_type?: string
          conflicting_statement_one?: string | null
          conflicting_statement_two?: string | null
          detected_at?: string
          id?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_one_id?: string | null
          source_one_type: string
          source_two_id?: string | null
          source_two_type: string
        }
        Update: {
          affected_topic?: string
          assigned_unit_id?: string | null
          conflict_type?: string
          conflicting_statement_one?: string | null
          conflicting_statement_two?: string | null
          detected_at?: string
          id?: string
          resolution_notes?: string | null
          resolution_status?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_one_id?: string | null
          source_one_type?: string
          source_two_id?: string | null
          source_two_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_conflicts_assigned_unit_id_fkey"
            columns: ["assigned_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_document_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_documents: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          authoritative_language: string
          category_id: string | null
          checksum: string | null
          chunking_status: Database["public"]["Enums"]["doc_status"]
          citation_url: string | null
          confidentiality: string
          confidentiality_level: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          detected_language: string | null
          document_type: string
          effective_date: string | null
          embedding_status: Database["public"]["Enums"]["doc_status"]
          expiry_date: string | null
          extraction_error: string | null
          extraction_status: string
          file_name: string | null
          file_size_bytes: number | null
          id: string
          indexing_status: Database["public"]["Enums"]["doc_status"]
          intended_audience: string
          is_active: boolean
          is_current: boolean
          is_official: boolean
          knowledge_domain: string | null
          language: Database["public"]["Enums"]["lang_code"]
          mime_type: string | null
          notes: string | null
          official_status: string
          owner_unit_id: string | null
          processing_status: string
          published_at: string | null
          quality_issues: Json
          quality_status: string
          retired_at: string | null
          retirement_reason: string | null
          review_date: string | null
          service_unit_id: string | null
          source_id: string | null
          storage_path: string | null
          superseded_by_document_id: string | null
          supersedes_document_id: string | null
          tags: Json
          title: string
          updated_at: string
          usage_count: number
          version: string
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          authoritative_language?: string
          category_id?: string | null
          checksum?: string | null
          chunking_status?: Database["public"]["Enums"]["doc_status"]
          citation_url?: string | null
          confidentiality?: string
          confidentiality_level?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          detected_language?: string | null
          document_type?: string
          effective_date?: string | null
          embedding_status?: Database["public"]["Enums"]["doc_status"]
          expiry_date?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          indexing_status?: Database["public"]["Enums"]["doc_status"]
          intended_audience?: string
          is_active?: boolean
          is_current?: boolean
          is_official?: boolean
          knowledge_domain?: string | null
          language?: Database["public"]["Enums"]["lang_code"]
          mime_type?: string | null
          notes?: string | null
          official_status?: string
          owner_unit_id?: string | null
          processing_status?: string
          published_at?: string | null
          quality_issues?: Json
          quality_status?: string
          retired_at?: string | null
          retirement_reason?: string | null
          review_date?: string | null
          service_unit_id?: string | null
          source_id?: string | null
          storage_path?: string | null
          superseded_by_document_id?: string | null
          supersedes_document_id?: string | null
          tags?: Json
          title: string
          updated_at?: string
          usage_count?: number
          version?: string
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          authoritative_language?: string
          category_id?: string | null
          checksum?: string | null
          chunking_status?: Database["public"]["Enums"]["doc_status"]
          citation_url?: string | null
          confidentiality?: string
          confidentiality_level?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          detected_language?: string | null
          document_type?: string
          effective_date?: string | null
          embedding_status?: Database["public"]["Enums"]["doc_status"]
          expiry_date?: string | null
          extraction_error?: string | null
          extraction_status?: string
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          indexing_status?: Database["public"]["Enums"]["doc_status"]
          intended_audience?: string
          is_active?: boolean
          is_current?: boolean
          is_official?: boolean
          knowledge_domain?: string | null
          language?: Database["public"]["Enums"]["lang_code"]
          mime_type?: string | null
          notes?: string | null
          official_status?: string
          owner_unit_id?: string | null
          processing_status?: string
          published_at?: string | null
          quality_issues?: Json
          quality_status?: string
          retired_at?: string | null
          retirement_reason?: string | null
          review_date?: string | null
          service_unit_id?: string | null
          source_id?: string | null
          storage_path?: string | null
          superseded_by_document_id?: string | null
          supersedes_document_id?: string | null
          tags?: Json
          title?: string
          updated_at?: string
          usage_count?: number
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "knowledge_document_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_owner_unit_id_fkey"
            columns: ["owner_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_superseded_by_document_id_fkey"
            columns: ["superseded_by_document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_supersedes_document_id_fkey"
            columns: ["supersedes_document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_gaps: {
        Row: {
          affected_services: Json
          affected_units: Json
          assigned_to: string | null
          average_confidence: number | null
          created_at: string
          human_handoff_count: number
          id: string
          language: string
          negative_feedback_count: number
          normalized_topic: string
          occurrence_count: number
          priority_score: number
          recommended_source_type: string | null
          sample_questions: Json
          status: string
          updated_at: string
        }
        Insert: {
          affected_services?: Json
          affected_units?: Json
          assigned_to?: string | null
          average_confidence?: number | null
          created_at?: string
          human_handoff_count?: number
          id?: string
          language?: string
          negative_feedback_count?: number
          normalized_topic: string
          occurrence_count?: number
          priority_score?: number
          recommended_source_type?: string | null
          sample_questions?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          affected_services?: Json
          affected_units?: Json
          assigned_to?: string | null
          average_confidence?: number | null
          created_at?: string
          human_handoff_count?: number
          id?: string
          language?: string
          negative_feedback_count?: number
          normalized_topic?: string
          occurrence_count?: number
          priority_score?: number
          recommended_source_type?: string | null
          sample_questions?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_issue_reports: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          id: string
          issue_type: string
          priority: string
          related_conversation_id: string | null
          reported_by: string
          resolved_at: string | null
          source_id: string | null
          source_type: string
          status: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type: string
          priority?: string
          related_conversation_id?: string | null
          reported_by: string
          resolved_at?: string | null
          source_id?: string | null
          source_type: string
          status?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type?: string
          priority?: string
          related_conversation_id?: string | null
          reported_by?: string
          resolved_at?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
        }
        Relationships: []
      }
      knowledge_retrieval_logs: {
        Row: {
          authority_score: number | null
          candidate_count: number | null
          chunk_id: string | null
          citation_used: boolean
          conversation_id: string | null
          effective_date: string | null
          fuzzy_score: number | null
          grounding_status: string | null
          id: string
          knowledge_domain: string | null
          knowledge_version: string | null
          language: string
          lexical_score: number | null
          message_id: string | null
          query_text: string | null
          rank_position: number | null
          retrieval_duration_ms: number | null
          retrieval_score: number | null
          retrieved_at: string
          section_title: string | null
          selected_count: number | null
          selected_for_response: boolean
          source_id: string | null
          source_title: string | null
          source_type: string
          trace_id: string | null
        }
        Insert: {
          authority_score?: number | null
          candidate_count?: number | null
          chunk_id?: string | null
          citation_used?: boolean
          conversation_id?: string | null
          effective_date?: string | null
          fuzzy_score?: number | null
          grounding_status?: string | null
          id?: string
          knowledge_domain?: string | null
          knowledge_version?: string | null
          language?: string
          lexical_score?: number | null
          message_id?: string | null
          query_text?: string | null
          rank_position?: number | null
          retrieval_duration_ms?: number | null
          retrieval_score?: number | null
          retrieved_at?: string
          section_title?: string | null
          selected_count?: number | null
          selected_for_response?: boolean
          source_id?: string | null
          source_title?: string | null
          source_type: string
          trace_id?: string | null
        }
        Update: {
          authority_score?: number | null
          candidate_count?: number | null
          chunk_id?: string | null
          citation_used?: boolean
          conversation_id?: string | null
          effective_date?: string | null
          fuzzy_score?: number | null
          grounding_status?: string | null
          id?: string
          knowledge_domain?: string | null
          knowledge_version?: string | null
          language?: string
          lexical_score?: number | null
          message_id?: string | null
          query_text?: string | null
          rank_position?: number | null
          retrieval_duration_ms?: number | null
          retrieval_score?: number | null
          retrieved_at?: string
          section_title?: string | null
          selected_count?: number | null
          selected_for_response?: boolean
          source_id?: string | null
          source_title?: string | null
          source_type?: string
          trace_id?: string | null
        }
        Relationships: []
      }
      knowledge_sources: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          id: string
          is_active: boolean
          service_unit_id: string | null
          source_url: string | null
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          service_unit_id?: string | null
          source_url?: string | null
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          is_active?: boolean
          service_unit_id?: string | null
          source_url?: string | null
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_routing_rules: {
        Row: {
          activation_mode: string
          active: boolean
          applied_count: number
          approved_at: string | null
          approved_by: string | null
          baseline_metrics: Json
          confidence: number
          created_at: string
          description: string | null
          effective_from: string
          evidence_count: number
          excluded_context: Json
          failure_count: number
          historical_accuracy: number | null
          id: string
          last_evaluated_at: string | null
          paused_at: string | null
          pending_domain: string | null
          priority: number
          required_context: Json
          risk_level: string
          rollback_reason: string | null
          rule_name: string
          rule_type: string
          shadow_accuracy: number | null
          shadow_samples: number
          source_candidate_id: string | null
          source_language: string
          status: string
          success_count: number
          target_domain: string | null
          target_intent: string | null
          target_service: string | null
          target_service_id: string | null
          target_unit_id: string | null
          trigger_context: string | null
          trigger_patterns: string[]
          trigger_phrases: string[]
          updated_at: string
        }
        Insert: {
          activation_mode?: string
          active?: boolean
          applied_count?: number
          approved_at?: string | null
          approved_by?: string | null
          baseline_metrics?: Json
          confidence?: number
          created_at?: string
          description?: string | null
          effective_from?: string
          evidence_count?: number
          excluded_context?: Json
          failure_count?: number
          historical_accuracy?: number | null
          id?: string
          last_evaluated_at?: string | null
          paused_at?: string | null
          pending_domain?: string | null
          priority?: number
          required_context?: Json
          risk_level?: string
          rollback_reason?: string | null
          rule_name: string
          rule_type?: string
          shadow_accuracy?: number | null
          shadow_samples?: number
          source_candidate_id?: string | null
          source_language?: string
          status?: string
          success_count?: number
          target_domain?: string | null
          target_intent?: string | null
          target_service?: string | null
          target_service_id?: string | null
          target_unit_id?: string | null
          trigger_context?: string | null
          trigger_patterns?: string[]
          trigger_phrases?: string[]
          updated_at?: string
        }
        Update: {
          activation_mode?: string
          active?: boolean
          applied_count?: number
          approved_at?: string | null
          approved_by?: string | null
          baseline_metrics?: Json
          confidence?: number
          created_at?: string
          description?: string | null
          effective_from?: string
          evidence_count?: number
          excluded_context?: Json
          failure_count?: number
          historical_accuracy?: number | null
          id?: string
          last_evaluated_at?: string | null
          paused_at?: string | null
          pending_domain?: string | null
          priority?: number
          required_context?: Json
          risk_level?: string
          rollback_reason?: string | null
          rule_name?: string
          rule_type?: string
          shadow_accuracy?: number | null
          shadow_samples?: number
          source_candidate_id?: string | null
          source_language?: string
          status?: string
          success_count?: number
          target_domain?: string | null
          target_intent?: string | null
          target_service?: string | null
          target_service_id?: string | null
          target_unit_id?: string | null
          trigger_context?: string | null
          trigger_patterns?: string[]
          trigger_phrases?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_routing_rules_source_candidate_id_fkey"
            columns: ["source_candidate_id"]
            isOneToOne: false
            referencedRelation: "learning_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learned_routing_rules_target_unit_id_fkey"
            columns: ["target_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      learned_rule_decisions: {
        Row: {
          activation_mode: string | null
          actual_target: string | null
          case_id: string | null
          confidence: number | null
          conversation_id: string | null
          created_at: string
          evidence_count: number | null
          id: string
          language: string | null
          latency_ms: number | null
          matched_context: Json
          matched_phrase: string | null
          mode: string
          outcome: string
          outcome_reason: string | null
          previous_target: string | null
          rule_id: string | null
          selected_target: string | null
          shadow_prediction: string | null
          updated_at: string
        }
        Insert: {
          activation_mode?: string | null
          actual_target?: string | null
          case_id?: string | null
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          evidence_count?: number | null
          id?: string
          language?: string | null
          latency_ms?: number | null
          matched_context?: Json
          matched_phrase?: string | null
          mode?: string
          outcome?: string
          outcome_reason?: string | null
          previous_target?: string | null
          rule_id?: string | null
          selected_target?: string | null
          shadow_prediction?: string | null
          updated_at?: string
        }
        Update: {
          activation_mode?: string | null
          actual_target?: string | null
          case_id?: string | null
          confidence?: number | null
          conversation_id?: string | null
          created_at?: string
          evidence_count?: number | null
          id?: string
          language?: string | null
          latency_ms?: number | null
          matched_context?: Json
          matched_phrase?: string | null
          mode?: string
          outcome?: string
          outcome_reason?: string | null
          previous_target?: string | null
          rule_id?: string | null
          selected_target?: string | null
          shadow_prediction?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learned_rule_decisions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "learned_routing_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      learning_candidates: {
        Row: {
          activated_at: string | null
          affected_domains: string[]
          affected_units: string[]
          approved_at: string | null
          approved_by: string | null
          baseline_metrics: Json | null
          candidate_type: string
          confidence: number
          created_at: string
          current_behaviour: string | null
          description: string
          evidence_count: number
          example_messages: Json
          id: string
          impact_metrics: Json | null
          pattern: Json
          pattern_key: string
          proposed_change: Json
          review_note: string | null
          risk_level: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          affected_domains?: string[]
          affected_units?: string[]
          approved_at?: string | null
          approved_by?: string | null
          baseline_metrics?: Json | null
          candidate_type: string
          confidence?: number
          created_at?: string
          current_behaviour?: string | null
          description: string
          evidence_count?: number
          example_messages?: Json
          id?: string
          impact_metrics?: Json | null
          pattern?: Json
          pattern_key: string
          proposed_change?: Json
          review_note?: string | null
          risk_level?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          affected_domains?: string[]
          affected_units?: string[]
          approved_at?: string | null
          approved_by?: string | null
          baseline_metrics?: Json | null
          candidate_type?: string
          confidence?: number
          created_at?: string
          current_behaviour?: string | null
          description?: string
          evidence_count?: number
          example_messages?: Json
          id?: string
          impact_metrics?: Json | null
          pattern?: Json
          pattern_key?: string
          proposed_change?: Json
          review_note?: string | null
          risk_level?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_config: {
        Row: {
          auto_activation_enabled: boolean
          created_at: string
          id: string
          is_singleton: boolean
          min_historical_accuracy: number
          min_shadow_accuracy: number
          min_shadow_samples: number
          pause_confidence: number
          pause_failure_streak: number
          threshold_high: number
          threshold_low: number
          threshold_normal: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_activation_enabled?: boolean
          created_at?: string
          id?: string
          is_singleton?: boolean
          min_historical_accuracy?: number
          min_shadow_accuracy?: number
          min_shadow_samples?: number
          pause_confidence?: number
          pause_failure_streak?: number
          threshold_high?: number
          threshold_low?: number
          threshold_normal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_activation_enabled?: boolean
          created_at?: string
          id?: string
          is_singleton?: boolean
          min_historical_accuracy?: number
          min_shadow_accuracy?: number
          min_shadow_samples?: number
          pause_confidence?: number
          pause_failure_streak?: number
          threshold_high?: number
          threshold_low?: number
          threshold_normal?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      learning_signals: {
        Row: {
          candidate_id: string | null
          case_id: string | null
          confidence: number
          conversation_id: string | null
          corrected_domain: string | null
          corrected_intent: string | null
          corrected_staff_id: string | null
          corrected_unit_id: string | null
          correction_source: string
          correction_type: string
          created_at: string
          id: string
          message_id: string | null
          original_domain: string | null
          original_intent: string | null
          original_staff_id: string | null
          original_unit_id: string | null
          original_user_text: string | null
          outcome: string | null
          policy_sensitive: boolean
          reason_code: string | null
          relevant_context_summary: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          staff_comment: string | null
          status: string
          student_feedback: string | null
          student_id: string | null
          updated_at: string
        }
        Insert: {
          candidate_id?: string | null
          case_id?: string | null
          confidence?: number
          conversation_id?: string | null
          corrected_domain?: string | null
          corrected_intent?: string | null
          corrected_staff_id?: string | null
          corrected_unit_id?: string | null
          correction_source: string
          correction_type: string
          created_at?: string
          id?: string
          message_id?: string | null
          original_domain?: string | null
          original_intent?: string | null
          original_staff_id?: string | null
          original_unit_id?: string | null
          original_user_text?: string | null
          outcome?: string | null
          policy_sensitive?: boolean
          reason_code?: string | null
          relevant_context_summary?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_comment?: string | null
          status?: string
          student_feedback?: string | null
          student_id?: string | null
          updated_at?: string
        }
        Update: {
          candidate_id?: string | null
          case_id?: string | null
          confidence?: number
          conversation_id?: string | null
          corrected_domain?: string | null
          corrected_intent?: string | null
          corrected_staff_id?: string | null
          corrected_unit_id?: string | null
          correction_source?: string
          correction_type?: string
          created_at?: string
          id?: string
          message_id?: string | null
          original_domain?: string | null
          original_intent?: string | null
          original_staff_id?: string | null
          original_unit_id?: string | null
          original_user_text?: string | null
          outcome?: string | null
          policy_sensitive?: boolean
          reason_code?: string | null
          relevant_context_summary?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          staff_comment?: string | null
          status?: string
          student_feedback?: string | null
          student_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "learning_signals_candidate_fk"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "learning_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_signals_corrected_unit_id_fkey"
            columns: ["corrected_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learning_signals_original_unit_id_fkey"
            columns: ["original_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      library_hours_exceptions: {
        Row: {
          closed: boolean
          closes_at: string | null
          created_at: string
          exception_date: string
          id: string
          library_location_id: string
          opens_at: string | null
          reason_ar: string | null
          reason_en: string | null
        }
        Insert: {
          closed?: boolean
          closes_at?: string | null
          created_at?: string
          exception_date: string
          id?: string
          library_location_id: string
          opens_at?: string | null
          reason_ar?: string | null
          reason_en?: string | null
        }
        Update: {
          closed?: boolean
          closes_at?: string | null
          created_at?: string
          exception_date?: string
          id?: string
          library_location_id?: string
          opens_at?: string | null
          reason_ar?: string | null
          reason_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_hours_exceptions_library_location_id_fkey"
            columns: ["library_location_id"]
            isOneToOne: false
            referencedRelation: "library_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_locations: {
        Row: {
          building_ar: string | null
          building_en: string | null
          campus_ar: string | null
          campus_en: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          is_active: boolean
          map_url: string | null
          name_ar: string
          name_en: string
          sort_order: number
          timezone: string
          updated_at: string
        }
        Insert: {
          building_ar?: string | null
          building_en?: string | null
          campus_ar?: string | null
          campus_en?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          map_url?: string | null
          name_ar: string
          name_en: string
          sort_order?: number
          timezone?: string
          updated_at?: string
        }
        Update: {
          building_ar?: string | null
          building_en?: string | null
          campus_ar?: string | null
          campus_en?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          map_url?: string | null
          name_ar?: string
          name_en?: string
          sort_order?: number
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      library_opening_hours: {
        Row: {
          audience_type: string
          closed: boolean
          closes_at: string | null
          created_at: string
          day_of_week: number
          effective_from: string | null
          effective_to: string | null
          id: string
          library_location_id: string
          opens_at: string | null
        }
        Insert: {
          audience_type?: string
          closed?: boolean
          closes_at?: string | null
          created_at?: string
          day_of_week: number
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          library_location_id: string
          opens_at?: string | null
        }
        Update: {
          audience_type?: string
          closed?: boolean
          closes_at?: string | null
          created_at?: string
          day_of_week?: number
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          library_location_id?: string
          opens_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_opening_hours_library_location_id_fkey"
            columns: ["library_location_id"]
            isOneToOne: false
            referencedRelation: "library_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      library_provider_settings: {
        Row: {
          api_key_secret_name: string
          auth_header_name: string
          auth_method: string
          auth_query_param: string | null
          availability_path: string | null
          base_url: string | null
          catalogue_url_template: string | null
          created_at: string
          eaccess_path: string | null
          enabled: boolean
          extra_headers: Json
          health_status: string
          id: string
          item_path: string | null
          last_error: string | null
          last_error_at: string | null
          last_latency_ms: number | null
          last_success_at: string | null
          location_path: string | null
          max_retries: number
          provider_key: string
          provider_name: string
          query_param_map: Json
          response_map: Json
          search_path: string | null
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          api_key_secret_name?: string
          auth_header_name?: string
          auth_method?: string
          auth_query_param?: string | null
          availability_path?: string | null
          base_url?: string | null
          catalogue_url_template?: string | null
          created_at?: string
          eaccess_path?: string | null
          enabled?: boolean
          extra_headers?: Json
          health_status?: string
          id?: string
          item_path?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_latency_ms?: number | null
          last_success_at?: string | null
          location_path?: string | null
          max_retries?: number
          provider_key: string
          provider_name: string
          query_param_map?: Json
          response_map?: Json
          search_path?: string | null
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          api_key_secret_name?: string
          auth_header_name?: string
          auth_method?: string
          auth_query_param?: string | null
          availability_path?: string | null
          base_url?: string | null
          catalogue_url_template?: string | null
          created_at?: string
          eaccess_path?: string | null
          enabled?: boolean
          extra_headers?: Json
          health_status?: string
          id?: string
          item_path?: string | null
          last_error?: string | null
          last_error_at?: string | null
          last_latency_ms?: number | null
          last_success_at?: string | null
          location_path?: string | null
          max_retries?: number
          provider_key?: string
          provider_name?: string
          query_param_map?: Json
          response_map?: Json
          search_path?: string | null
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      library_search_events: {
        Row: {
          created_at: string
          error_code: string | null
          id: string
          language: string
          provider_latency_ms: number | null
          provider_status: string
          query_terms: string | null
          result_count: number
          search_type: string
          student_id: string | null
          zero_results: boolean
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          id?: string
          language?: string
          provider_latency_ms?: number | null
          provider_status?: string
          query_terms?: string | null
          result_count?: number
          search_type?: string
          student_id?: string | null
          zero_results?: boolean
        }
        Update: {
          created_at?: string
          error_code?: string | null
          id?: string
          language?: string
          provider_latency_ms?: number | null
          provider_status?: string
          query_terms?: string | null
          result_count?: number
          search_type?: string
          student_id?: string | null
          zero_results?: boolean
        }
        Relationships: []
      }
      library_services: {
        Row: {
          availability_ar: string | null
          availability_en: string | null
          category: string
          contact: string | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          eligibility_ar: string | null
          eligibility_en: string | null
          id: string
          instructions_ar: string | null
          instructions_en: string | null
          is_active: boolean
          library_location_id: string | null
          name_ar: string
          name_en: string
          service_key: string
          sort_order: number
          updated_at: string
          url: string | null
        }
        Insert: {
          availability_ar?: string | null
          availability_en?: string | null
          category?: string
          contact?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          eligibility_ar?: string | null
          eligibility_en?: string | null
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          library_location_id?: string | null
          name_ar: string
          name_en: string
          service_key: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Update: {
          availability_ar?: string | null
          availability_en?: string | null
          category?: string
          contact?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          eligibility_ar?: string | null
          eligibility_en?: string | null
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          library_location_id?: string | null
          name_ar?: string
          name_en?: string
          service_key?: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_services_library_location_id_fkey"
            columns: ["library_location_id"]
            isOneToOne: false
            referencedRelation: "library_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          created_at: string
          file_name: string
          id: string
          message_id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          message_id: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          message_id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          language: Database["public"]["Enums"]["lang_code"] | null
          metadata: Json
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"] | null
          metadata?: Json
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          language?: Database["public"]["Enums"]["lang_code"] | null
          metadata?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      model_routing_rules: {
        Row: {
          complexity_level: string
          created_at: string
          fallback_model: string | null
          fallback_provider: string | null
          id: string
          is_active: boolean
          maximum_input_tokens: number
          maximum_output_tokens: number
          preferred_model: string
          preferred_provider: string
          reasoning_effort: string | null
          task_type: string
          timeout_ms: number
          updated_at: string
        }
        Insert: {
          complexity_level?: string
          created_at?: string
          fallback_model?: string | null
          fallback_provider?: string | null
          id?: string
          is_active?: boolean
          maximum_input_tokens?: number
          maximum_output_tokens?: number
          preferred_model: string
          preferred_provider?: string
          reasoning_effort?: string | null
          task_type: string
          timeout_ms?: number
          updated_at?: string
        }
        Update: {
          complexity_level?: string
          created_at?: string
          fallback_model?: string | null
          fallback_provider?: string | null
          id?: string
          is_active?: boolean
          maximum_input_tokens?: number
          maximum_output_tokens?: number
          preferred_model?: string
          preferred_provider?: string
          reasoning_effort?: string | null
          task_type?: string
          timeout_ms?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_deliveries: {
        Row: {
          action_url: string | null
          case_id: string | null
          channel: string
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          emergency_broadcast_id: string | null
          event_type: string
          failed_at: string | null
          failure_code: string | null
          failure_reason: string | null
          id: string
          language: string
          locked_at: string | null
          next_attempt_at: string
          notification_event_id: string | null
          provider_message_id: string | null
          queued_at: string
          recipient_email: string | null
          recipient_role: string | null
          recipient_user_id: string | null
          retry_count: number
          sent_at: string | null
          service_unit_id: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          status: string
          subject: string | null
          template_code: string
          template_vars: Json
          template_version: number | null
          updated_at: string
        }
        Insert: {
          action_url?: string | null
          case_id?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          emergency_broadcast_id?: string | null
          event_type: string
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          language?: string
          locked_at?: string | null
          next_attempt_at?: string
          notification_event_id?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_email?: string | null
          recipient_role?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          service_unit_id?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          status?: string
          subject?: string | null
          template_code: string
          template_vars?: Json
          template_version?: number | null
          updated_at?: string
        }
        Update: {
          action_url?: string | null
          case_id?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          delivered_at?: string | null
          emergency_broadcast_id?: string | null
          event_type?: string
          failed_at?: string | null
          failure_code?: string | null
          failure_reason?: string | null
          id?: string
          language?: string
          locked_at?: string | null
          next_attempt_at?: string
          notification_event_id?: string | null
          provider_message_id?: string | null
          queued_at?: string
          recipient_email?: string | null
          recipient_role?: string | null
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          service_unit_id?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          status?: string
          subject?: string | null
          template_code?: string
          template_vars?: Json
          template_version?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_event_id_fkey"
            columns: ["notification_event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_logs: {
        Row: {
          alert_id: string | null
          attempted_at: string
          channel: string
          created_at: string
          delivered_at: string | null
          id: string
          provider_response: Json | null
          recipient_masked: string | null
          status: string
          student_alert_id: string | null
          subject: string | null
          user_id: string
        }
        Insert: {
          alert_id?: string | null
          attempted_at?: string
          channel: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          provider_response?: Json | null
          recipient_masked?: string | null
          status?: string
          student_alert_id?: string | null
          subject?: string | null
          user_id: string
        }
        Update: {
          alert_id?: string | null
          attempted_at?: string
          channel?: string
          created_at?: string
          delivered_at?: string | null
          id?: string
          provider_response?: Json | null
          recipient_masked?: string | null
          status?: string
          student_alert_id?: string | null
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_logs_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_delivery_logs_student_alert_id_fkey"
            columns: ["student_alert_id"]
            isOneToOne: false
            referencedRelation: "student_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dispatch_state: {
        Row: {
          consecutive_failures: number
          id: boolean
          last_run_at: string | null
          lease_until: string | null
          pause_reason: string | null
          paused: boolean
          paused_at: string | null
          sender_domain_checked_at: string | null
          sender_domain_reason: string | null
          sender_domain_status: string
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          id?: boolean
          last_run_at?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          sender_domain_checked_at?: string | null
          sender_domain_reason?: string | null
          sender_domain_status?: string
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          id?: boolean
          last_run_at?: string | null
          lease_until?: string | null
          pause_reason?: string | null
          paused?: boolean
          paused_at?: string | null
          sender_domain_checked_at?: string | null
          sender_domain_reason?: string | null
          sender_domain_status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_event_types: {
        Row: {
          admin_group_code: string | null
          audience: string
          category: string
          created_at: string
          digest_eligible: boolean
          email_enabled: boolean
          enabled: boolean
          event_type: string
          name_ar: string
          name_en: string
          severity: Database["public"]["Enums"]["notification_severity"]
          student_optional: boolean
          template_code: string | null
          throttle_seconds: number
          updated_at: string
        }
        Insert: {
          admin_group_code?: string | null
          audience?: string
          category?: string
          created_at?: string
          digest_eligible?: boolean
          email_enabled?: boolean
          enabled?: boolean
          event_type: string
          name_ar: string
          name_en: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          student_optional?: boolean
          template_code?: string | null
          throttle_seconds?: number
          updated_at?: string
        }
        Update: {
          admin_group_code?: string | null
          audience?: string
          category?: string
          created_at?: string
          digest_eligible?: boolean
          email_enabled?: boolean
          enabled?: boolean
          event_type?: string
          name_ar?: string
          name_en?: string
          severity?: Database["public"]["Enums"]["notification_severity"]
          student_optional?: boolean
          template_code?: string | null
          throttle_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      notification_events: {
        Row: {
          action_url: string | null
          body: string | null
          case_id: string | null
          channel: string
          created_at: string
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string
          error_message: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          read_at: string | null
          recipient_profile_id: string | null
          retry_count: number
          scheduled_at: string
          service_unit_id: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          status: string
          template_id: string | null
          title: string | null
          triggered_by: string | null
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          case_id?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type: string
          error_message?: string | null
          event_type: string
          id?: string
          payload?: Json
          processed_at?: string | null
          read_at?: string | null
          recipient_profile_id?: string | null
          retry_count?: number
          scheduled_at?: string
          service_unit_id?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          status?: string
          template_id?: string | null
          title?: string | null
          triggered_by?: string | null
        }
        Update: {
          action_url?: string | null
          body?: string | null
          case_id?: string | null
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string
          error_message?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          read_at?: string | null
          recipient_profile_id?: string | null
          retry_count?: number
          scheduled_at?: string
          service_unit_id?: string | null
          severity?: Database["public"]["Enums"]["notification_severity"]
          status?: string
          template_id?: string | null
          title?: string | null
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_recipient_profile_id_fkey"
            columns: ["recipient_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_group_members: {
        Row: {
          created_at: string
          email: string | null
          group_code: string
          id: string
          is_active: boolean
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          group_code: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          group_code?: string
          id?: string
          is_active?: boolean
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_group_members_group_code_fkey"
            columns: ["group_code"]
            isOneToOne: false
            referencedRelation: "notification_groups"
            referencedColumns: ["code"]
          },
        ]
      }
      notification_groups: {
        Row: {
          code: string
          created_at: string
          description: string | null
          enabled: boolean
          is_emergency: boolean
          name_ar: string
          name_en: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          is_emergency?: boolean
          name_ar: string
          name_en: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          enabled?: boolean
          is_emergency?: boolean
          name_ar?: string
          name_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          assignment_email: boolean
          categories: string[]
          created_at: string
          digest_enabled: boolean
          email: boolean
          immediate_critical: boolean
          in_app: boolean
          optional_email_categories: string[]
          push: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sla_warning_email: boolean
          sms: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          assignment_email?: boolean
          categories?: string[]
          created_at?: string
          digest_enabled?: boolean
          email?: boolean
          immediate_critical?: boolean
          in_app?: boolean
          optional_email_categories?: string[]
          push?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sla_warning_email?: boolean
          sms?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          assignment_email?: boolean
          categories?: string[]
          created_at?: string
          digest_enabled?: boolean
          email?: boolean
          immediate_critical?: boolean
          in_app?: boolean
          optional_email_categories?: string[]
          push?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sla_warning_email?: boolean
          sms?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          batch_size: number
          demo_email_mode: boolean
          demo_redirect_email: string | null
          digest_enabled: boolean
          digest_hour: number
          emails_enabled: boolean
          id: boolean
          max_retries: number
          public_app_url: string
          sender_name: string
          updated_at: string
        }
        Insert: {
          batch_size?: number
          demo_email_mode?: boolean
          demo_redirect_email?: string | null
          digest_enabled?: boolean
          digest_hour?: number
          emails_enabled?: boolean
          id?: boolean
          max_retries?: number
          public_app_url?: string
          sender_name?: string
          updated_at?: string
        }
        Update: {
          batch_size?: number
          demo_email_mode?: boolean
          demo_redirect_email?: string | null
          digest_enabled?: boolean
          digest_hour?: number
          emails_enabled?: boolean
          id?: boolean
          max_retries?: number
          public_app_url?: string
          sender_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      notification_templates: {
        Row: {
          action_label_template: string | null
          body_template: string
          channel: string
          created_at: string
          event_type: string
          id: string
          is_active: boolean
          language: Database["public"]["Enums"]["lang_code"]
          subject_template: string
          version: number
        }
        Insert: {
          action_label_template?: string | null
          body_template: string
          channel?: string
          created_at?: string
          event_type: string
          id?: string
          is_active?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          subject_template: string
          version?: number
        }
        Update: {
          action_label_template?: string | null
          body_template?: string
          channel?: string
          created_at?: string
          event_type?: string
          id?: string
          is_active?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          subject_template?: string
          version?: number
        }
        Relationships: []
      }
      operation_idempotency: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          expires_at: string
          id: string
          idempotency_key: string
          operation_type: string
          request_hash: string
          response_snapshot: Json | null
          status: string
          user_profile_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string
          id?: string
          idempotency_key: string
          operation_type: string
          request_hash: string
          response_snapshot?: Json | null
          status?: string
          user_profile_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string
          id?: string
          idempotency_key?: string
          operation_type?: string
          request_hash?: string
          response_snapshot?: Json | null
          status?: string
          user_profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_idempotency_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_insights: {
        Row: {
          affected_units: Json
          confidence_score: number | null
          generated_at: string
          id: string
          insight_type: string
          linked_improvement_id: string | null
          recommended_action_ar: string | null
          recommended_action_en: string | null
          review_status: string
          reviewed_by: string | null
          summary_ar: string | null
          summary_en: string | null
          supporting_metrics: Json
          title_ar: string | null
          title_en: string
        }
        Insert: {
          affected_units?: Json
          confidence_score?: number | null
          generated_at?: string
          id?: string
          insight_type: string
          linked_improvement_id?: string | null
          recommended_action_ar?: string | null
          recommended_action_en?: string | null
          review_status?: string
          reviewed_by?: string | null
          summary_ar?: string | null
          summary_en?: string | null
          supporting_metrics?: Json
          title_ar?: string | null
          title_en: string
        }
        Update: {
          affected_units?: Json
          confidence_score?: number | null
          generated_at?: string
          id?: string
          insight_type?: string
          linked_improvement_id?: string | null
          recommended_action_ar?: string | null
          recommended_action_en?: string | null
          review_status?: string
          reviewed_by?: string | null
          summary_ar?: string | null
          summary_en?: string | null
          supporting_metrics?: Json
          title_ar?: string | null
          title_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_insights_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_budgets: {
        Row: {
          budget_ms: number
          id: string
          is_active: boolean
          label_ar: string
          label_en: string
          response_category: string
          updated_at: string
        }
        Insert: {
          budget_ms: number
          id?: string
          is_active?: boolean
          label_ar: string
          label_en: string
          response_category: string
          updated_at?: string
        }
        Update: {
          budget_ms?: number
          id?: string
          is_active?: boolean
          label_ar?: string
          label_en?: string
          response_category?: string
          updated_at?: string
        }
        Relationships: []
      }
      pilot_test_sessions: {
        Row: {
          comments: string | null
          completed_successfully: boolean
          created_at: string
          id: string
          issues: string | null
          participant_count: number
          participant_role: string
          recorded_by: string | null
          satisfaction_rating: number | null
          service_label: string | null
          tested_on: string
          time_taken_minutes: number | null
          university_service_id: string | null
        }
        Insert: {
          comments?: string | null
          completed_successfully?: boolean
          created_at?: string
          id?: string
          issues?: string | null
          participant_count?: number
          participant_role: string
          recorded_by?: string | null
          satisfaction_rating?: number | null
          service_label?: string | null
          tested_on?: string
          time_taken_minutes?: number | null
          university_service_id?: string | null
        }
        Update: {
          comments?: string | null
          completed_successfully?: boolean
          created_at?: string
          id?: string
          issues?: string | null
          participant_count?: number
          participant_role?: string
          recorded_by?: string | null
          satisfaction_rating?: number | null
          service_label?: string | null
          tested_on?: string
          time_taken_minutes?: number | null
          university_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_test_sessions_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_revoked_at: string | null
          access_revoked_by: string | null
          access_revoked_reason: string | null
          avatar_url: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_demo_account: boolean
          phone: string | null
          preferred_language: Database["public"]["Enums"]["lang_code"]
          updated_at: string
        }
        Insert: {
          access_revoked_at?: string | null
          access_revoked_by?: string | null
          access_revoked_reason?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_demo_account?: boolean
          phone?: string | null
          preferred_language?: Database["public"]["Enums"]["lang_code"]
          updated_at?: string
        }
        Update: {
          access_revoked_at?: string | null
          access_revoked_by?: string | null
          access_revoked_reason?: string | null
          avatar_url?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_demo_account?: boolean
          phone?: string | null
          preferred_language?: Database["public"]["Enums"]["lang_code"]
          updated_at?: string
        }
        Relationships: []
      }
      program_basket_courses: {
        Row: {
          basket_id: string
          category_label: string | null
          course_id: string
          created_at: string
          id: string
          updated_at: string
        }
        Insert: {
          basket_id: string
          category_label?: string | null
          course_id: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Update: {
          basket_id?: string
          category_label?: string | null
          course_id?: string
          created_at?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_basket_courses_basket_id_fkey"
            columns: ["basket_id"]
            isOneToOne: false
            referencedRelation: "program_requirement_baskets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_basket_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      program_courses: {
        Row: {
          course_id: string
          created_at: string
          id: string
          is_required: boolean
          program_id: string
          recommended_semester: number | null
          recommended_year: number | null
          requirement_type: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          is_required?: boolean
          program_id: string
          recommended_semester?: number | null
          recommended_year?: number | null
          requirement_type?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          is_required?: boolean
          program_id?: string
          recommended_semester?: number | null
          recommended_year?: number | null
          requirement_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "program_courses_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      program_requirement_baskets: {
        Row: {
          basket_type: string
          code: string
          course_list_verified: boolean
          created_at: string
          display_order: number
          effective_catalog_year: string
          id: string
          max_credit_hours_per_category: number | null
          name_ar: string
          name_en: string
          program_id: string
          required_course_count: number
          required_credit_hours: number
          selection_note_ar: string | null
          selection_note_en: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          basket_type: string
          code: string
          course_list_verified?: boolean
          created_at?: string
          display_order?: number
          effective_catalog_year: string
          id?: string
          max_credit_hours_per_category?: number | null
          name_ar: string
          name_en: string
          program_id: string
          required_course_count: number
          required_credit_hours: number
          selection_note_ar?: string | null
          selection_note_en?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          basket_type?: string
          code?: string
          course_list_verified?: boolean
          created_at?: string
          display_order?: number
          effective_catalog_year?: string
          id?: string
          max_credit_hours_per_category?: number | null
          name_ar?: string
          name_en?: string
          program_id?: string
          required_course_count?: number
          required_credit_hours?: number
          selection_note_ar?: string | null
          selection_note_en?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "program_requirement_baskets_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_course_equivalencies: {
        Row: {
          approved_status: string
          counts_as_core: boolean
          counts_as_elective: boolean
          counts_toward_degree: boolean
          created_at: string
          credit_hours_accepted: number
          effective_from: string
          effective_to: string | null
          equivalency_type: string
          id: string
          notes: string | null
          rule_version: string
          source_course_id: string
          source_programme_id: string
          target_course_id: string | null
          target_programme_id: string
          updated_at: string
        }
        Insert: {
          approved_status?: string
          counts_as_core?: boolean
          counts_as_elective?: boolean
          counts_toward_degree?: boolean
          created_at?: string
          credit_hours_accepted?: number
          effective_from?: string
          effective_to?: string | null
          equivalency_type: string
          id?: string
          notes?: string | null
          rule_version?: string
          source_course_id: string
          source_programme_id: string
          target_course_id?: string | null
          target_programme_id: string
          updated_at?: string
        }
        Update: {
          approved_status?: string
          counts_as_core?: boolean
          counts_as_elective?: boolean
          counts_toward_degree?: boolean
          created_at?: string
          credit_hours_accepted?: number
          effective_from?: string
          effective_to?: string | null
          equivalency_type?: string
          id?: string
          notes?: string | null
          rule_version?: string
          source_course_id?: string
          source_programme_id?: string
          target_course_id?: string | null
          target_programme_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_course_equivalencies_source_course_id_fkey"
            columns: ["source_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_course_equivalencies_source_programme_id_fkey"
            columns: ["source_programme_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_course_equivalencies_target_course_id_fkey"
            columns: ["target_course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_course_equivalencies_target_programme_id_fkey"
            columns: ["target_programme_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      programme_transfer_capacity: {
        Row: {
          academic_term_id: string | null
          assigned_transfer_seats: number
          available_transfer_seats: number | null
          created_at: string
          id: string
          is_active: boolean
          is_demo_record: boolean
          programme_id: string
          reserved_transfer_seats: number
          total_transfer_seats: number
          updated_at: string
        }
        Insert: {
          academic_term_id?: string | null
          assigned_transfer_seats?: number
          available_transfer_seats?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          programme_id: string
          reserved_transfer_seats?: number
          total_transfer_seats?: number
          updated_at?: string
        }
        Update: {
          academic_term_id?: string | null
          assigned_transfer_seats?: number
          available_transfer_seats?: number | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          programme_id?: string
          reserved_transfer_seats?: number
          total_transfer_seats?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programme_transfer_capacity_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "programme_transfer_capacity_programme_id_fkey"
            columns: ["programme_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_targets: {
        Row: {
          comparator: string
          id: string
          is_active: boolean
          is_critical: boolean
          label_ar: string
          label_en: string
          measured_at: string | null
          measured_value: number | null
          metric_key: string
          sample_size: number | null
          target_value: number
          unit: string
          updated_at: string
        }
        Insert: {
          comparator?: string
          id?: string
          is_active?: boolean
          is_critical?: boolean
          label_ar: string
          label_en: string
          measured_at?: string | null
          measured_value?: number | null
          metric_key: string
          sample_size?: number | null
          target_value: number
          unit?: string
          updated_at?: string
        }
        Update: {
          comparator?: string
          id?: string
          is_active?: boolean
          is_critical?: boolean
          label_ar?: string
          label_en?: string
          measured_at?: string | null
          measured_value?: number | null
          metric_key?: string
          sample_size?: number | null
          target_value?: number
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      release_readiness: {
        Row: {
          evaluated_at: string | null
          evaluated_by: string | null
          evidence: Json
          gate_key: string
          id: string
          is_blocking: boolean
          label_ar: string
          label_en: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          evaluated_at?: string | null
          evaluated_by?: string | null
          evidence?: Json
          gate_key: string
          id?: string
          is_blocking?: boolean
          label_ar: string
          label_en: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          evaluated_at?: string | null
          evaluated_by?: string | null
          evidence?: Json
          gate_key?: string
          id?: string
          is_blocking?: boolean
          label_ar?: string
          label_en?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_readiness_evaluated_by_fkey"
            columns: ["evaluated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      response_cache_metadata: {
        Row: {
          cache_key: string
          created_at: string
          data_category: string
          expires_at: string
          id: string
          invalidated_at: string | null
          invalidation_reason: string | null
          language: Database["public"]["Enums"]["lang_code"]
          payload: Json
          source_version: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          data_category: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          language?: Database["public"]["Enums"]["lang_code"]
          payload?: Json
          source_version?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          data_category?: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          invalidation_reason?: string | null
          language?: Database["public"]["Enums"]["lang_code"]
          payload?: Json
          source_version?: string | null
        }
        Relationships: []
      }
      response_performance_logs: {
        Row: {
          agent_run_id: string | null
          authentication_duration_ms: number
          budget_exceeded: boolean
          cache_hit: boolean
          conversation_id: string | null
          created_at: string
          database_duration_ms: number
          db_query_count: number | null
          db_slowest_ms: number | null
          db_slowest_operation: string | null
          db_total_ms: number | null
          domains: string[]
          error_kind: string | null
          execution_path: string | null
          external_api_ms: number | null
          finalization_ms: number | null
          first_token_ms: number | null
          first_visible_feedback_ms: number
          first_visible_ms: number | null
          generation_duration_ms: number
          id: string
          input_tokens: number | null
          intent: string | null
          intent_duration_ms: number
          language: Database["public"]["Enums"]["lang_code"]
          message_id: string | null
          model_call_count: number
          model_name: string | null
          model_names: string[]
          model_queue_ms: number | null
          output_tokens: number | null
          parallel_tool_count: number
          partial_failure: boolean
          prompt_breakdown: Json
          prompt_tokens: number
          rate_limited: boolean
          response_bytes: number
          response_category: string
          retrieval_duration_ms: number
          retrieval_tokens: number
          routing_ms: number | null
          stream_chunk_count: number | null
          stream_duration_ms: number | null
          student_context_ms: number | null
          success: boolean
          supervisor_duration_ms: number
          supervisor_invoked: boolean
          supervisor_latency_ms: number | null
          supervisor_reason: string | null
          tool_count: number
          tool_duration_ms: number
          total_duration_ms: number
          trace_id: string | null
        }
        Insert: {
          agent_run_id?: string | null
          authentication_duration_ms?: number
          budget_exceeded?: boolean
          cache_hit?: boolean
          conversation_id?: string | null
          created_at?: string
          database_duration_ms?: number
          db_query_count?: number | null
          db_slowest_ms?: number | null
          db_slowest_operation?: string | null
          db_total_ms?: number | null
          domains?: string[]
          error_kind?: string | null
          execution_path?: string | null
          external_api_ms?: number | null
          finalization_ms?: number | null
          first_token_ms?: number | null
          first_visible_feedback_ms?: number
          first_visible_ms?: number | null
          generation_duration_ms?: number
          id?: string
          input_tokens?: number | null
          intent?: string | null
          intent_duration_ms?: number
          language?: Database["public"]["Enums"]["lang_code"]
          message_id?: string | null
          model_call_count?: number
          model_name?: string | null
          model_names?: string[]
          model_queue_ms?: number | null
          output_tokens?: number | null
          parallel_tool_count?: number
          partial_failure?: boolean
          prompt_breakdown?: Json
          prompt_tokens?: number
          rate_limited?: boolean
          response_bytes?: number
          response_category?: string
          retrieval_duration_ms?: number
          retrieval_tokens?: number
          routing_ms?: number | null
          stream_chunk_count?: number | null
          stream_duration_ms?: number | null
          student_context_ms?: number | null
          success?: boolean
          supervisor_duration_ms?: number
          supervisor_invoked?: boolean
          supervisor_latency_ms?: number | null
          supervisor_reason?: string | null
          tool_count?: number
          tool_duration_ms?: number
          total_duration_ms?: number
          trace_id?: string | null
        }
        Update: {
          agent_run_id?: string | null
          authentication_duration_ms?: number
          budget_exceeded?: boolean
          cache_hit?: boolean
          conversation_id?: string | null
          created_at?: string
          database_duration_ms?: number
          db_query_count?: number | null
          db_slowest_ms?: number | null
          db_slowest_operation?: string | null
          db_total_ms?: number | null
          domains?: string[]
          error_kind?: string | null
          execution_path?: string | null
          external_api_ms?: number | null
          finalization_ms?: number | null
          first_token_ms?: number | null
          first_visible_feedback_ms?: number
          first_visible_ms?: number | null
          generation_duration_ms?: number
          id?: string
          input_tokens?: number | null
          intent?: string | null
          intent_duration_ms?: number
          language?: Database["public"]["Enums"]["lang_code"]
          message_id?: string | null
          model_call_count?: number
          model_name?: string | null
          model_names?: string[]
          model_queue_ms?: number | null
          output_tokens?: number | null
          parallel_tool_count?: number
          partial_failure?: boolean
          prompt_breakdown?: Json
          prompt_tokens?: number
          rate_limited?: boolean
          response_bytes?: number
          response_category?: string
          retrieval_duration_ms?: number
          retrieval_tokens?: number
          routing_ms?: number | null
          stream_chunk_count?: number | null
          stream_duration_ms?: number | null
          student_context_ms?: number | null
          success?: boolean
          supervisor_duration_ms?: number
          supervisor_invoked?: boolean
          supervisor_latency_ms?: number | null
          supervisor_reason?: string | null
          tool_count?: number
          tool_duration_ms?: number
          total_duration_ms?: number
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "response_performance_logs_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_performance_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_performance_logs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      response_quality_reviews: {
        Row: {
          action_relevance_score: number | null
          agent_run_id: string | null
          citation_score: number | null
          comments: string | null
          completeness_score: number | null
          conciseness_score: number | null
          created_at: string
          factual_score: number | null
          id: string
          intent_score: number | null
          issue_tags: Json
          language_score: number | null
          privacy_score: number | null
          proposed_correction: string | null
          reviewer_profile_id: string | null
          reviewer_type: string
          safety_score: number | null
          student_data_score: number | null
          task_completion_score: number | null
          tone_score: number | null
          tool_selection_score: number | null
        }
        Insert: {
          action_relevance_score?: number | null
          agent_run_id?: string | null
          citation_score?: number | null
          comments?: string | null
          completeness_score?: number | null
          conciseness_score?: number | null
          created_at?: string
          factual_score?: number | null
          id?: string
          intent_score?: number | null
          issue_tags?: Json
          language_score?: number | null
          privacy_score?: number | null
          proposed_correction?: string | null
          reviewer_profile_id?: string | null
          reviewer_type?: string
          safety_score?: number | null
          student_data_score?: number | null
          task_completion_score?: number | null
          tone_score?: number | null
          tool_selection_score?: number | null
        }
        Update: {
          action_relevance_score?: number | null
          agent_run_id?: string | null
          citation_score?: number | null
          comments?: string | null
          completeness_score?: number | null
          conciseness_score?: number | null
          created_at?: string
          factual_score?: number | null
          id?: string
          intent_score?: number | null
          issue_tags?: Json
          language_score?: number | null
          privacy_score?: number | null
          proposed_correction?: string | null
          reviewer_profile_id?: string | null
          reviewer_type?: string
          safety_score?: number | null
          student_data_score?: number | null
          task_completion_score?: number | null
          tone_score?: number | null
          tool_selection_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "response_quality_reviews_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "response_quality_reviews_reviewer_profile_id_fkey"
            columns: ["reviewer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_flags: {
        Row: {
          case_id: string | null
          created_at: string
          flag_type: string
          id: string
          notes: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["urgency_level"]
          user_id: string | null
        }
        Insert: {
          case_id?: string | null
          created_at?: string
          flag_type: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          user_id?: string | null
        }
        Update: {
          case_id?: string | null
          created_at?: string
          flag_type?: string
          id?: string
          notes?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_flags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_flags_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_decisions: {
        Row: {
          case_id: string
          confidence_score: number | null
          created_at: string
          decided_by: string
          final_staff_id: string | null
          final_unit_id: string | null
          id: string
          matched_rule_id: string | null
          overridden: boolean
          override_reason: string | null
          recommended_staff_id: string | null
          recommended_unit_id: string | null
        }
        Insert: {
          case_id: string
          confidence_score?: number | null
          created_at?: string
          decided_by?: string
          final_staff_id?: string | null
          final_unit_id?: string | null
          id?: string
          matched_rule_id?: string | null
          overridden?: boolean
          override_reason?: string | null
          recommended_staff_id?: string | null
          recommended_unit_id?: string | null
        }
        Update: {
          case_id?: string
          confidence_score?: number | null
          created_at?: string
          decided_by?: string
          final_staff_id?: string | null
          final_unit_id?: string | null
          id?: string
          matched_rule_id?: string | null
          overridden?: boolean
          override_reason?: string | null
          recommended_staff_id?: string | null
          recommended_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_decisions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_final_staff_id_fkey"
            columns: ["final_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_final_unit_id_fkey"
            columns: ["final_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_matched_rule_id_fkey"
            columns: ["matched_rule_id"]
            isOneToOne: false
            referencedRelation: "routing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_recommended_staff_id_fkey"
            columns: ["recommended_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_decisions_recommended_unit_id_fkey"
            columns: ["recommended_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_rules: {
        Row: {
          assignment_method: string
          conditions: Json
          created_at: string
          id: string
          is_active: boolean
          priority: number
          requires_human_review: boolean
          rule_name: string
          target_role: Database["public"]["Enums"]["app_role"] | null
          target_staff_id: string | null
          target_unit_id: string | null
          updated_at: string
        }
        Insert: {
          assignment_method?: string
          conditions?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          requires_human_review?: boolean
          rule_name: string
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_staff_id?: string | null
          target_unit_id?: string | null
          updated_at?: string
        }
        Update: {
          assignment_method?: string
          conditions?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          priority?: number
          requires_human_review?: boolean
          rule_name?: string
          target_role?: Database["public"]["Enums"]["app_role"] | null
          target_staff_id?: string | null
          target_unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routing_rules_target_staff_id_fkey"
            columns: ["target_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_rules_target_unit_id_fkey"
            columns: ["target_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_job_runs: {
        Row: {
          completed_at: string | null
          error_summary: string | null
          failures: number
          id: string
          job_name: string
          records_processed: number
          started_at: string
          status: string
          successes: number
        }
        Insert: {
          completed_at?: string | null
          error_summary?: string | null
          failures?: number
          id?: string
          job_name: string
          records_processed?: number
          started_at?: string
          status?: string
          successes?: number
        }
        Update: {
          completed_at?: string | null
          error_summary?: string | null
          failures?: number
          id?: string
          job_name?: string
          records_processed?: number
          started_at?: string
          status?: string
          successes?: number
        }
        Relationships: []
      }
      service_availability_audit: {
        Row: {
          action: string
          changed_by: string | null
          created_at: string
          id: string
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          service_id: string | null
          window_id: string | null
        }
        Insert: {
          action: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          service_id?: string | null
          window_id?: string | null
        }
        Update: {
          action?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          service_id?: string | null
          window_id?: string | null
        }
        Relationships: []
      }
      service_availability_windows: {
        Row: {
          academic_term_id: string | null
          academic_year: string | null
          availability_type: string
          closes_at: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          opens_at: string | null
          preliminary_check_allowed: boolean
          reason_ar: string | null
          reason_en: string | null
          reminders_enabled: boolean
          service_id: string
          status: string
          student_message_ar: string | null
          student_message_en: string | null
          student_visible: boolean
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          academic_term_id?: string | null
          academic_year?: string | null
          availability_type?: string
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          opens_at?: string | null
          preliminary_check_allowed?: boolean
          reason_ar?: string | null
          reason_en?: string | null
          reminders_enabled?: boolean
          service_id: string
          status?: string
          student_message_ar?: string | null
          student_message_en?: string | null
          student_visible?: boolean
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          academic_term_id?: string | null
          academic_year?: string | null
          availability_type?: string
          closes_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          opens_at?: string | null
          preliminary_check_allowed?: boolean
          reason_ar?: string | null
          reason_en?: string | null
          reminders_enabled?: boolean
          service_id?: string
          status?: string
          student_message_ar?: string | null
          student_message_en?: string | null
          student_visible?: boolean
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_availability_windows_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_availability_windows_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_baselines: {
        Row: {
          avg_processing_hours: number | null
          channels: string[]
          created_at: string
          fields_requested: number | null
          forms: number | null
          id: string
          notes: string | null
          recorded_by: string | null
          staff_touchpoints: number | null
          steps: number | null
          university_service_id: string
          updated_at: string
          visits: number | null
        }
        Insert: {
          avg_processing_hours?: number | null
          channels?: string[]
          created_at?: string
          fields_requested?: number | null
          forms?: number | null
          id?: string
          notes?: string | null
          recorded_by?: string | null
          staff_touchpoints?: number | null
          steps?: number | null
          university_service_id: string
          updated_at?: string
          visits?: number | null
        }
        Update: {
          avg_processing_hours?: number | null
          channels?: string[]
          created_at?: string
          fields_requested?: number | null
          forms?: number | null
          id?: string
          notes?: string | null
          recorded_by?: string | null
          staff_touchpoints?: number | null
          steps?: number | null
          university_service_id?: string
          updated_at?: string
          visits?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_baselines_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: true
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_degradation_state: {
        Row: {
          component: string
          id: string
          message_ar: string | null
          message_en: string | null
          since: string
          state: string
          updated_at: string
        }
        Insert: {
          component: string
          id?: string
          message_ar?: string | null
          message_en?: string | null
          since?: string
          state?: string
          updated_at?: string
        }
        Update: {
          component?: string
          id?: string
          message_ar?: string | null
          message_en?: string | null
          since?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_impact_baselines: {
        Row: {
          after_approvals: number
          after_fields: number
          after_flow_ar: string
          after_flow_en: string
          after_processing_hours: number
          after_staff_touches: number
          after_steps: number
          after_visits: number
          before_approvals: number
          before_fields: number
          before_flow_ar: string
          before_flow_en: string
          before_processing_hours: number
          before_staff_touches: number
          before_steps: number
          before_visits: number
          created_at: string
          display_order: number
          highlight: boolean
          id: string
          is_demo: boolean
          journey_ar: string
          journey_code: string
          journey_en: string
          service_unit_id: string | null
        }
        Insert: {
          after_approvals: number
          after_fields: number
          after_flow_ar: string
          after_flow_en: string
          after_processing_hours: number
          after_staff_touches: number
          after_steps: number
          after_visits: number
          before_approvals: number
          before_fields: number
          before_flow_ar: string
          before_flow_en: string
          before_processing_hours: number
          before_staff_touches: number
          before_steps: number
          before_visits: number
          created_at?: string
          display_order?: number
          highlight?: boolean
          id?: string
          is_demo?: boolean
          journey_ar: string
          journey_code: string
          journey_en: string
          service_unit_id?: string | null
        }
        Update: {
          after_approvals?: number
          after_fields?: number
          after_flow_ar?: string
          after_flow_en?: string
          after_processing_hours?: number
          after_staff_touches?: number
          after_steps?: number
          after_visits?: number
          before_approvals?: number
          before_fields?: number
          before_flow_ar?: string
          before_flow_en?: string
          before_processing_hours?: number
          before_staff_touches?: number
          before_steps?: number
          before_visits?: number
          created_at?: string
          display_order?: number
          highlight?: boolean
          id?: string
          is_demo?: boolean
          journey_ar?: string
          journey_code?: string
          journey_en?: string
          service_unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_impact_baselines_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_improvements: {
        Row: {
          actual_impact: string | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          expected_impact: string | null
          id: string
          owner_profile_id: string | null
          responsible_unit_id: string | null
          source_case_ids: Json
          source_suggestion_ids: Json
          source_type: string
          status: string
          target_date: string | null
          title_ar: string | null
          title_en: string
          updated_at: string
        }
        Insert: {
          actual_impact?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expected_impact?: string | null
          id?: string
          owner_profile_id?: string | null
          responsible_unit_id?: string | null
          source_case_ids?: Json
          source_suggestion_ids?: Json
          source_type?: string
          status?: string
          target_date?: string | null
          title_ar?: string | null
          title_en: string
          updated_at?: string
        }
        Update: {
          actual_impact?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expected_impact?: string | null
          id?: string
          owner_profile_id?: string | null
          responsible_unit_id?: string | null
          source_case_ids?: Json
          source_suggestion_ids?: Json
          source_type?: string
          status?: string
          target_date?: string | null
          title_ar?: string | null
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_improvements_owner_profile_id_fkey"
            columns: ["owner_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_improvements_responsible_unit_id_fkey"
            columns: ["responsible_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_knowledge_health: {
        Row: {
          coverage_score: number
          knowledge_gaps: number
          service_id: string
          topics_with_approved_source: number
          topics_with_ar_content: number
          topics_with_authoritative_source: number
          topics_with_current_source: number
          topics_with_en_content: number
          total_known_topics: number
          unresolved_conflicts: number
          updated_at: string
        }
        Insert: {
          coverage_score?: number
          knowledge_gaps?: number
          service_id: string
          topics_with_approved_source?: number
          topics_with_ar_content?: number
          topics_with_authoritative_source?: number
          topics_with_current_source?: number
          topics_with_en_content?: number
          total_known_topics?: number
          unresolved_conflicts?: number
          updated_at?: string
        }
        Update: {
          coverage_score?: number
          knowledge_gaps?: number
          service_id?: string
          topics_with_approved_source?: number
          topics_with_ar_content?: number
          topics_with_authoritative_source?: number
          topics_with_current_source?: number
          topics_with_en_content?: number
          total_known_topics?: number
          unresolved_conflicts?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_knowledge_health_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: true
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_level_rules: {
        Row: {
          acknowledge_hours: number
          case_type: Database["public"]["Enums"]["case_type"]
          created_at: string
          id: string
          owner_response_hours: number
          pause_on_student: boolean
          resolve_days: number
          service_unit_id: string | null
          stall_hours: number
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Insert: {
          acknowledge_hours?: number
          case_type: Database["public"]["Enums"]["case_type"]
          created_at?: string
          id?: string
          owner_response_hours?: number
          pause_on_student?: boolean
          resolve_days?: number
          service_unit_id?: string | null
          stall_hours?: number
          urgency: Database["public"]["Enums"]["urgency_level"]
        }
        Update: {
          acknowledge_hours?: number
          case_type?: Database["public"]["Enums"]["case_type"]
          created_at?: string
          id?: string
          owner_response_hours?: number
          pause_on_student?: boolean
          resolve_days?: number
          service_unit_id?: string | null
          stall_hours?: number
          urgency?: Database["public"]["Enums"]["urgency_level"]
        }
        Relationships: [
          {
            foreignKeyName: "service_level_rules_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_owner_action_permissions: {
        Row: {
          action_code: string
          created_at: string
          enabled: boolean
          id: string
          requires_confirmation: boolean
          requires_reason: boolean
          risk_level: string
          role: Database["public"]["Enums"]["app_role"]
          service_unit_id: string
          updated_at: string
        }
        Insert: {
          action_code: string
          created_at?: string
          enabled?: boolean
          id?: string
          requires_confirmation?: boolean
          requires_reason?: boolean
          risk_level?: string
          role?: Database["public"]["Enums"]["app_role"]
          service_unit_id: string
          updated_at?: string
        }
        Update: {
          action_code?: string
          created_at?: string
          enabled?: boolean
          id?: string
          requires_confirmation?: boolean
          requires_reason?: boolean
          risk_level?: string
          role?: Database["public"]["Enums"]["app_role"]
          service_unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_owner_action_permissions_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      service_owner_ai_preferences: {
        Row: {
          auto_close_eligible_cases: boolean
          auto_escalate_by_policy: boolean
          auto_follow_up: boolean
          auto_prepare_resolution: boolean
          auto_request_missing_information: boolean
          auto_send_routine_updates: boolean
          created_at: string
          id: string
          preferred_response_style: string
          require_review_for_all_student_messages: boolean
          staff_profile_id: string
          updated_at: string
        }
        Insert: {
          auto_close_eligible_cases?: boolean
          auto_escalate_by_policy?: boolean
          auto_follow_up?: boolean
          auto_prepare_resolution?: boolean
          auto_request_missing_information?: boolean
          auto_send_routine_updates?: boolean
          created_at?: string
          id?: string
          preferred_response_style?: string
          require_review_for_all_student_messages?: boolean
          staff_profile_id: string
          updated_at?: string
        }
        Update: {
          auto_close_eligible_cases?: boolean
          auto_escalate_by_policy?: boolean
          auto_follow_up?: boolean
          auto_prepare_resolution?: boolean
          auto_request_missing_information?: boolean
          auto_send_routine_updates?: boolean
          created_at?: string
          id?: string
          preferred_response_style?: string
          require_review_for_all_student_messages?: boolean
          staff_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_owner_ai_preferences_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_process_metrics: {
        Row: {
          average_processing_minutes: number | null
          average_staff_effort_minutes: number | null
          average_student_effort_minutes: number | null
          cost_per_case: number | null
          created_at: string
          digital_completion_rate: number | null
          first_pass_success_rate: number | null
          id: string
          measurement_period: string
          physical_visits: number | null
          process_version: string
          required_documents: number | null
          required_fields: number | null
          satisfaction_score: number | null
          total_steps: number | null
          university_service_id: string | null
        }
        Insert: {
          average_processing_minutes?: number | null
          average_staff_effort_minutes?: number | null
          average_student_effort_minutes?: number | null
          cost_per_case?: number | null
          created_at?: string
          digital_completion_rate?: number | null
          first_pass_success_rate?: number | null
          id?: string
          measurement_period: string
          physical_visits?: number | null
          process_version?: string
          required_documents?: number | null
          required_fields?: number | null
          satisfaction_score?: number | null
          total_steps?: number | null
          university_service_id?: string | null
        }
        Update: {
          average_processing_minutes?: number | null
          average_staff_effort_minutes?: number | null
          average_student_effort_minutes?: number | null
          cost_per_case?: number | null
          created_at?: string
          digital_completion_rate?: number | null
          first_pass_success_rate?: number | null
          id?: string
          measurement_period?: string
          physical_visits?: number | null
          process_version?: string
          required_documents?: number | null
          required_fields?: number | null
          satisfaction_score?: number | null
          total_steps?: number | null
          university_service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_process_metrics_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_requirements: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_mandatory: boolean
          requirement_name_ar: string
          requirement_name_en: string
          requirement_type: string
          university_service_id: string
          validation_rule: string | null
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_mandatory?: boolean
          requirement_name_ar: string
          requirement_name_en: string
          requirement_type?: string
          university_service_id: string
          validation_rule?: string | null
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_mandatory?: boolean
          requirement_name_ar?: string
          requirement_name_en?: string
          requirement_type?: string
          university_service_id?: string
          validation_rule?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_requirements_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_staff: {
        Row: {
          can_approve_actions: boolean
          can_approve_normal_resolution: boolean
          can_assign_cases: boolean
          can_escalate: boolean
          can_receive_cases: boolean
          can_view_sensitive_cases: boolean
          created_at: string
          id: string
          is_active: boolean
          is_demo_record: boolean
          is_service_owner: boolean
          role_type: string
          service_unit_id: string
          staff_profile_id: string
          updated_at: string
        }
        Insert: {
          can_approve_actions?: boolean
          can_approve_normal_resolution?: boolean
          can_assign_cases?: boolean
          can_escalate?: boolean
          can_receive_cases?: boolean
          can_view_sensitive_cases?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          is_service_owner?: boolean
          role_type?: string
          service_unit_id: string
          staff_profile_id: string
          updated_at?: string
        }
        Update: {
          can_approve_actions?: boolean
          can_approve_normal_resolution?: boolean
          can_assign_cases?: boolean
          can_escalate?: boolean
          can_receive_cases?: boolean
          can_view_sensitive_cases?: boolean
          created_at?: string
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          is_service_owner?: boolean
          role_type?: string
          service_unit_id?: string
          staff_profile_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_staff_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_staff_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_staff_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
        ]
      }
      service_unit_owners: {
        Row: {
          assigned_by: string | null
          created_at: string
          ended_at: string | null
          id: string
          is_active: boolean
          is_demo_record: boolean
          notes: string | null
          ownership_type: string
          service_unit_id: string
          staff_profile_id: string
          started_at: string
          updated_at: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          notes?: string | null
          ownership_type?: string
          service_unit_id: string
          staff_profile_id: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          is_active?: boolean
          is_demo_record?: boolean
          notes?: string | null
          ownership_type?: string
          service_unit_id?: string
          staff_profile_id?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_unit_owners_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_unit_owners_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_unit_owners_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_unit_owners_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
        ]
      }
      service_units: {
        Row: {
          appointment_enabled: boolean
          code: string
          college_id: string | null
          contact_email: string | null
          created_at: string
          department_id: string | null
          description_ar: string | null
          description_en: string | null
          email: string | null
          escalation_unit_id: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          office_location_ar: string | null
          office_location_en: string | null
          phone_extension: string | null
          primary_service_owner_id: string | null
          service_hours_ar: string | null
          service_hours_en: string | null
          university_id: string | null
          updated_at: string
        }
        Insert: {
          appointment_enabled?: boolean
          code: string
          college_id?: string | null
          contact_email?: string | null
          created_at?: string
          department_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          email?: string | null
          escalation_unit_id?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          office_location_ar?: string | null
          office_location_en?: string | null
          phone_extension?: string | null
          primary_service_owner_id?: string | null
          service_hours_ar?: string | null
          service_hours_en?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Update: {
          appointment_enabled?: boolean
          code?: string
          college_id?: string | null
          contact_email?: string | null
          created_at?: string
          department_id?: string | null
          description_ar?: string | null
          description_en?: string | null
          email?: string | null
          escalation_unit_id?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          office_location_ar?: string | null
          office_location_en?: string | null
          phone_extension?: string | null
          primary_service_owner_id?: string | null
          service_hours_ar?: string | null
          service_hours_en?: string | null
          university_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_units_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_units_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_units_escalation_unit_id_fkey"
            columns: ["escalation_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_units_primary_service_owner_id_fkey"
            columns: ["primary_service_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "service_units_primary_service_owner_id_fkey"
            columns: ["primary_service_owner_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
          {
            foreignKeyName: "service_units_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
      service_workflow_steps: {
        Row: {
          created_at: string
          expected_duration_hours: number
          id: string
          is_student_visible: boolean
          requires_approval: boolean
          responsible_unit_id: string | null
          step_name_ar: string
          step_name_en: string
          step_number: number
          university_service_id: string
        }
        Insert: {
          created_at?: string
          expected_duration_hours?: number
          id?: string
          is_student_visible?: boolean
          requires_approval?: boolean
          responsible_unit_id?: string | null
          step_name_ar: string
          step_name_en: string
          step_number: number
          university_service_id: string
        }
        Update: {
          created_at?: string
          expected_duration_hours?: number
          id?: string
          is_student_visible?: boolean
          requires_approval?: boolean
          responsible_unit_id?: string | null
          step_name_ar?: string
          step_name_en?: string
          step_number?: number
          university_service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_workflow_steps_responsible_unit_id_fkey"
            columns: ["responsible_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_workflow_steps_university_service_id_fkey"
            columns: ["university_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability_rules: {
        Row: {
          appointment_type_id: string | null
          capacity: number
          created_at: string
          created_by: string | null
          end_minute: number
          id: string
          is_active: boolean
          location: string | null
          meeting_link: string | null
          service_unit_id: string
          slot_minutes: number
          staff_profile_id: string | null
          start_minute: number
          updated_at: string
          valid_from: string
          valid_to: string | null
          weekday: number
        }
        Insert: {
          appointment_type_id?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          end_minute: number
          id?: string
          is_active?: boolean
          location?: string | null
          meeting_link?: string | null
          service_unit_id: string
          slot_minutes?: number
          staff_profile_id?: string | null
          start_minute: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          weekday: number
        }
        Update: {
          appointment_type_id?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          end_minute?: number
          id?: string
          is_active?: boolean
          location?: string | null
          meeting_link?: string | null
          service_unit_id?: string
          slot_minutes?: number
          staff_profile_id?: string | null
          start_minute?: number
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_rules_appointment_type_id_fkey"
            columns: ["appointment_type_id"]
            isOneToOne: false
            referencedRelation: "appointment_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_rules_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_availability_rules_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "staff_availability_rules_staff_profile_id_fkey"
            columns: ["staff_profile_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
        ]
      }
      staff_profiles: {
        Row: {
          availability_status: string
          created_at: string
          is_active: boolean
          job_title_ar: string | null
          job_title_en: string | null
          last_assigned_at: string | null
          must_change_password: boolean
          service_unit_id: string | null
          staff_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          availability_status?: string
          created_at?: string
          is_active?: boolean
          job_title_ar?: string | null
          job_title_en?: string | null
          last_assigned_at?: string | null
          must_change_password?: boolean
          service_unit_id?: string | null
          staff_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          availability_status?: string
          created_at?: string
          is_active?: boolean
          job_title_ar?: string | null
          job_title_en?: string | null
          last_assigned_at?: string | null
          must_change_password?: boolean
          service_unit_id?: string | null
          staff_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      structured_data_sources: {
        Row: {
          allowed_columns: Json
          approved_view_or_function: string
          connector_id: string | null
          created_at: string
          filtering_rules: Json
          id: string
          is_active: boolean
          last_sync_at: string | null
          maximum_rows: number
          refresh_strategy: string
          source_name: string
          source_type: string
          updated_at: string
        }
        Insert: {
          allowed_columns?: Json
          approved_view_or_function: string
          connector_id?: string | null
          created_at?: string
          filtering_rules?: Json
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          maximum_rows?: number
          refresh_strategy?: string
          source_name: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          allowed_columns?: Json
          approved_view_or_function?: string
          connector_id?: string | null
          created_at?: string
          filtering_rules?: Json
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          maximum_rows?: number
          refresh_strategy?: string
          source_name?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "structured_data_sources_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "integration_connectors"
            referencedColumns: ["id"]
          },
        ]
      }
      student_alerts: {
        Row: {
          action_completed_at: string | null
          action_label_ar: string | null
          action_label_en: string | null
          action_taken_at: string | null
          action_url: string | null
          alert_id: string | null
          alert_rule_id: string | null
          alert_type: string
          body_ar: string | null
          body_en: string | null
          created_at: string
          deadline: string | null
          dismissed_at: string | null
          generated_at: string
          id: string
          is_read: boolean
          read_at: string | null
          related_case_id: string | null
          related_service_id: string | null
          severity: Database["public"]["Enums"]["urgency_level"]
          source_unit_id: string | null
          status: string
          student_id: string
          title_ar: string | null
          title_en: string | null
        }
        Insert: {
          action_completed_at?: string | null
          action_label_ar?: string | null
          action_label_en?: string | null
          action_taken_at?: string | null
          action_url?: string | null
          alert_id?: string | null
          alert_rule_id?: string | null
          alert_type?: string
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          deadline?: string | null
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          related_case_id?: string | null
          related_service_id?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          source_unit_id?: string | null
          status?: string
          student_id: string
          title_ar?: string | null
          title_en?: string | null
        }
        Update: {
          action_completed_at?: string | null
          action_label_ar?: string | null
          action_label_en?: string | null
          action_taken_at?: string | null
          action_url?: string | null
          alert_id?: string | null
          alert_rule_id?: string | null
          alert_type?: string
          body_ar?: string | null
          body_en?: string | null
          created_at?: string
          deadline?: string | null
          dismissed_at?: string | null
          generated_at?: string
          id?: string
          is_read?: boolean
          read_at?: string | null
          related_case_id?: string | null
          related_service_id?: string | null
          severity?: Database["public"]["Enums"]["urgency_level"]
          source_unit_id?: string | null
          status?: string
          student_id?: string
          title_ar?: string | null
          title_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_alerts_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_alerts_alert_rule_id_fkey"
            columns: ["alert_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_alerts_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_alerts_related_case_id_fkey"
            columns: ["related_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_alerts_related_service_id_fkey"
            columns: ["related_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_alerts_source_unit_id_fkey"
            columns: ["source_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      student_appointments: {
        Row: {
          appointment_slot_id: string
          booked_by: string | null
          cancelled_at: string | null
          case_id: string | null
          confirmation_code: string
          created_at: string
          id: string
          purpose: string | null
          status: string
          student_id: string
        }
        Insert: {
          appointment_slot_id: string
          booked_by?: string | null
          cancelled_at?: string | null
          case_id?: string | null
          confirmation_code: string
          created_at?: string
          id?: string
          purpose?: string | null
          status?: string
          student_id: string
        }
        Update: {
          appointment_slot_id?: string
          booked_by?: string | null
          cancelled_at?: string | null
          case_id?: string | null
          confirmation_code?: string
          created_at?: string
          id?: string
          purpose?: string | null
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_appointments_appointment_slot_id_fkey"
            columns: ["appointment_slot_id"]
            isOneToOne: false
            referencedRelation: "appointment_slots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_appointments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "case_monitor_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_appointments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      student_career_profiles: {
        Row: {
          career_fit_updated_at: string | null
          counsellor_requested: boolean
          created_at: string
          id: string
          latest_cv_id: string | null
          preferred_fields: string[]
          preferred_locations: string[]
          preferred_roles: string[]
          preferred_sectors: string[]
          shared_with_counsellor: boolean
          student_id: string
          updated_at: string
          work_mode: string | null
          work_orientation: string | null
        }
        Insert: {
          career_fit_updated_at?: string | null
          counsellor_requested?: boolean
          created_at?: string
          id?: string
          latest_cv_id?: string | null
          preferred_fields?: string[]
          preferred_locations?: string[]
          preferred_roles?: string[]
          preferred_sectors?: string[]
          shared_with_counsellor?: boolean
          student_id: string
          updated_at?: string
          work_mode?: string | null
          work_orientation?: string | null
        }
        Update: {
          career_fit_updated_at?: string | null
          counsellor_requested?: boolean
          created_at?: string
          id?: string
          latest_cv_id?: string | null
          preferred_fields?: string[]
          preferred_locations?: string[]
          preferred_roles?: string[]
          preferred_sectors?: string[]
          shared_with_counsellor?: boolean
          student_id?: string
          updated_at?: string
          work_mode?: string | null
          work_orientation?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "student_career_profiles_latest_cv_id_fkey"
            columns: ["latest_cv_id"]
            isOneToOne: false
            referencedRelation: "student_cv_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      student_course_history: {
        Row: {
          academic_term_id: string | null
          completion_status: string
          course_id: string
          created_at: string
          credits_attempted: number
          credits_earned: number
          grade: string | null
          grade_points: number | null
          id: string
          student_id: string
        }
        Insert: {
          academic_term_id?: string | null
          completion_status?: string
          course_id: string
          created_at?: string
          credits_attempted?: number
          credits_earned?: number
          grade?: string | null
          grade_points?: number | null
          id?: string
          student_id: string
        }
        Update: {
          academic_term_id?: string | null
          completion_status?: string
          course_id?: string
          created_at?: string
          credits_attempted?: number
          credits_earned?: number
          grade?: string | null
          grade_points?: number | null
          id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_course_history_academic_term_id_fkey"
            columns: ["academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_course_history_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      student_current_enrollments: {
        Row: {
          course_section_id: string
          enrollment_status: string
          id: string
          registration_date: string
          student_id: string
        }
        Insert: {
          course_section_id: string
          enrollment_status?: string
          id?: string
          registration_date?: string
          student_id: string
        }
        Update: {
          course_section_id?: string
          enrollment_status?: string
          id?: string
          registration_date?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_current_enrollments_course_section_id_fkey"
            columns: ["course_section_id"]
            isOneToOne: false
            referencedRelation: "course_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      student_cv_documents: {
        Row: {
          content_sha256: string | null
          created_at: string
          deleted_at: string | null
          detected_language: string
          discrepancies: Json
          file_name: string
          id: string
          injection_flags: Json
          is_current: boolean
          mime_type: string | null
          original_file_path: string
          parsed_profile_json: Json
          parsed_text: string | null
          parsing_error: string | null
          parsing_status: string
          scan_status: string
          size_bytes: number | null
          student_id: string
          uploaded_at: string
        }
        Insert: {
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          detected_language?: string
          discrepancies?: Json
          file_name: string
          id?: string
          injection_flags?: Json
          is_current?: boolean
          mime_type?: string | null
          original_file_path: string
          parsed_profile_json?: Json
          parsed_text?: string | null
          parsing_error?: string | null
          parsing_status?: string
          scan_status?: string
          size_bytes?: number | null
          student_id: string
          uploaded_at?: string
        }
        Update: {
          content_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          detected_language?: string
          discrepancies?: Json
          file_name?: string
          id?: string
          injection_flags?: Json
          is_current?: boolean
          mime_type?: string | null
          original_file_path?: string
          parsed_profile_json?: Json
          parsed_text?: string | null
          parsing_error?: string | null
          parsing_status?: string
          scan_status?: string
          size_bytes?: number | null
          student_id?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      student_documents: {
        Row: {
          document_name: string
          document_type: string
          expiry_date: string | null
          id: string
          issued_date: string | null
          storage_path: string | null
          student_id: string
          uploaded_at: string
          verification_status: string
        }
        Insert: {
          document_name: string
          document_type: string
          expiry_date?: string | null
          id?: string
          issued_date?: string | null
          storage_path?: string | null
          student_id: string
          uploaded_at?: string
          verification_status?: string
        }
        Update: {
          document_name?: string
          document_type?: string
          expiry_date?: string | null
          id?: string
          issued_date?: string | null
          storage_path?: string | null
          student_id?: string
          uploaded_at?: string
          verification_status?: string
        }
        Relationships: []
      }
      student_field_provenance: {
        Row: {
          field_key: string
          field_value: string | null
          id: string
          source: string
          student_id: string
          updated_at: string
          verified_at: string
        }
        Insert: {
          field_key: string
          field_value?: string | null
          id?: string
          source: string
          student_id: string
          updated_at?: string
          verified_at?: string
        }
        Update: {
          field_key?: string
          field_value?: string | null
          id?: string
          source?: string
          student_id?: string
          updated_at?: string
          verified_at?: string
        }
        Relationships: []
      }
      student_holds: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          expires_at: string | null
          hold_type: string
          id: string
          issued_at: string
          issuing_unit_id: string | null
          prevents_graduation: boolean
          prevents_registration: boolean
          resolution_action_ar: string | null
          resolution_action_en: string | null
          status: string
          student_id: string
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expires_at?: string | null
          hold_type: string
          id?: string
          issued_at?: string
          issuing_unit_id?: string | null
          prevents_graduation?: boolean
          prevents_registration?: boolean
          resolution_action_ar?: string | null
          resolution_action_en?: string | null
          status?: string
          student_id: string
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          expires_at?: string | null
          hold_type?: string
          id?: string
          issued_at?: string
          issuing_unit_id?: string | null
          prevents_graduation?: boolean
          prevents_registration?: boolean
          resolution_action_ar?: string | null
          resolution_action_en?: string | null
          status?: string
          student_id?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_holds_issuing_unit_id_fkey"
            columns: ["issuing_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      student_housing_preferences: {
        Row: {
          accessibility_required: boolean
          created_at: string
          id: string
          notes: string | null
          preferred_hostel_id: string | null
          preferred_location: string | null
          preferred_room_type: string | null
          roommate_preference: string | null
          student_id: string
          updated_at: string
        }
        Insert: {
          accessibility_required?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          preferred_hostel_id?: string | null
          preferred_location?: string | null
          preferred_room_type?: string | null
          roommate_preference?: string | null
          student_id: string
          updated_at?: string
        }
        Update: {
          accessibility_required?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          preferred_hostel_id?: string | null
          preferred_location?: string | null
          preferred_room_type?: string | null
          roommate_preference?: string | null
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_housing_preferences_preferred_hostel_id_fkey"
            columns: ["preferred_hostel_id"]
            isOneToOne: false
            referencedRelation: "hostels"
            referencedColumns: ["id"]
          },
        ]
      }
      student_internship_preferences: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          preferred_cities: Json
          preferred_emirates: Json
          preferred_fields: Json
          preferred_organization_types: Json
          preferred_role_keywords: Json
          preferred_sectors: Json
          preferred_work_mode: string | null
          student_id: string
          updated_at: string
          willing_to_relocate: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          preferred_cities?: Json
          preferred_emirates?: Json
          preferred_fields?: Json
          preferred_organization_types?: Json
          preferred_role_keywords?: Json
          preferred_sectors?: Json
          preferred_work_mode?: string | null
          student_id: string
          updated_at?: string
          willing_to_relocate?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          preferred_cities?: Json
          preferred_emirates?: Json
          preferred_fields?: Json
          preferred_organization_types?: Json
          preferred_role_keywords?: Json
          preferred_sectors?: Json
          preferred_work_mode?: string | null
          student_id?: string
          updated_at?: string
          willing_to_relocate?: boolean
        }
        Relationships: []
      }
      student_profiles: {
        Row: {
          academic_level: string | null
          academic_standing: string
          accessibility_support_required: boolean
          account_status: string
          admission_term_id: string | null
          advisor_staff_id: string | null
          college: string | null
          college_id: string | null
          completed_credit_hours: number
          created_at: string
          cumulative_gpa: number | null
          current_academic_term_id: string | null
          department_id: string | null
          expected_graduation_date: string | null
          is_demo_record: boolean
          preferred_language: Database["public"]["Enums"]["lang_code"]
          preferred_name: string | null
          preferred_notification_channel: string
          program: string | null
          program_id: string | null
          registered_credit_hours: number
          residency_status: string | null
          scholarship_status: string | null
          student_number: string | null
          updated_at: string
          user_id: string
          year_of_study: number | null
        }
        Insert: {
          academic_level?: string | null
          academic_standing?: string
          accessibility_support_required?: boolean
          account_status?: string
          admission_term_id?: string | null
          advisor_staff_id?: string | null
          college?: string | null
          college_id?: string | null
          completed_credit_hours?: number
          created_at?: string
          cumulative_gpa?: number | null
          current_academic_term_id?: string | null
          department_id?: string | null
          expected_graduation_date?: string | null
          is_demo_record?: boolean
          preferred_language?: Database["public"]["Enums"]["lang_code"]
          preferred_name?: string | null
          preferred_notification_channel?: string
          program?: string | null
          program_id?: string | null
          registered_credit_hours?: number
          residency_status?: string | null
          scholarship_status?: string | null
          student_number?: string | null
          updated_at?: string
          user_id: string
          year_of_study?: number | null
        }
        Update: {
          academic_level?: string | null
          academic_standing?: string
          accessibility_support_required?: boolean
          account_status?: string
          admission_term_id?: string | null
          advisor_staff_id?: string | null
          college?: string | null
          college_id?: string | null
          completed_credit_hours?: number
          created_at?: string
          cumulative_gpa?: number | null
          current_academic_term_id?: string | null
          department_id?: string | null
          expected_graduation_date?: string | null
          is_demo_record?: boolean
          preferred_language?: Database["public"]["Enums"]["lang_code"]
          preferred_name?: string | null
          preferred_notification_channel?: string
          program?: string | null
          program_id?: string | null
          registered_credit_hours?: number
          residency_status?: string | null
          scholarship_status?: string | null
          student_number?: string | null
          updated_at?: string
          user_id?: string
          year_of_study?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "student_profiles_admission_term_id_fkey"
            columns: ["admission_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_profiles_advisor_staff_id_fkey"
            columns: ["advisor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "student_profiles_advisor_staff_id_fkey"
            columns: ["advisor_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_workload_summary"
            referencedColumns: ["staff_profile_id"]
          },
          {
            foreignKeyName: "student_profiles_college_id_fkey"
            columns: ["college_id"]
            isOneToOne: false
            referencedRelation: "colleges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_profiles_current_academic_term_id_fkey"
            columns: ["current_academic_term_id"]
            isOneToOne: false
            referencedRelation: "academic_terms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_profiles_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      student_requirements: {
        Row: {
          action_url: string | null
          created_at: string
          due_date: string | null
          id: string
          requirement_type: string
          responsible_unit_id: string | null
          status: string
          student_id: string
          title_ar: string
          title_en: string
          updated_at: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          requirement_type: string
          responsible_unit_id?: string | null
          status?: string
          student_id: string
          title_ar: string
          title_en: string
          updated_at?: string
        }
        Update: {
          action_url?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          requirement_type?: string
          responsible_unit_id?: string | null
          status?: string
          student_id?: string
          title_ar?: string
          title_en?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_requirements_responsible_unit_id_fkey"
            columns: ["responsible_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      student_service_reminders: {
        Row: {
          availability_window_id: string | null
          cancelled_at: string | null
          created_at: string
          id: string
          reminder_type: string
          scheduled_for: string
          sent_at: string | null
          service_id: string
          status: string
          student_id: string
        }
        Insert: {
          availability_window_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          reminder_type?: string
          scheduled_for: string
          sent_at?: string | null
          service_id: string
          status?: string
          student_id: string
        }
        Update: {
          availability_window_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          id?: string
          reminder_type?: string
          scheduled_for?: string
          sent_at?: string | null
          service_id?: string
          status?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_service_reminders_availability_window_id_fkey"
            columns: ["availability_window_id"]
            isOneToOne: false
            referencedRelation: "service_availability_windows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_service_reminders_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_assessments: {
        Row: {
          created_at: string
          duplicate_assessment: string | null
          estimated_cost_band: string | null
          feasibility_score: number | null
          id: string
          implementation_complexity: string | null
          rationale: string | null
          recommendation: string | null
          reviewer_id: string | null
          strategic_alignment_score: number | null
          student_impact_score: number | null
          suggestion_id: string
        }
        Insert: {
          created_at?: string
          duplicate_assessment?: string | null
          estimated_cost_band?: string | null
          feasibility_score?: number | null
          id?: string
          implementation_complexity?: string | null
          rationale?: string | null
          recommendation?: string | null
          reviewer_id?: string | null
          strategic_alignment_score?: number | null
          student_impact_score?: number | null
          suggestion_id: string
        }
        Update: {
          created_at?: string
          duplicate_assessment?: string | null
          estimated_cost_band?: string | null
          feasibility_score?: number | null
          id?: string
          implementation_complexity?: string | null
          rationale?: string | null
          recommendation?: string | null
          reviewer_id?: string | null
          strategic_alignment_score?: number | null
          student_impact_score?: number | null
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_assessments_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_assessments_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_duplicates: {
        Row: {
          created_at: string
          duplicate_of: string
          id: string
          similarity: number | null
          suggestion_id: string
        }
        Insert: {
          created_at?: string
          duplicate_of: string
          id?: string
          similarity?: number | null
          suggestion_id: string
        }
        Update: {
          created_at?: string
          duplicate_of?: string
          id?: string
          similarity?: number | null
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_duplicates_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_duplicates_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_reviews: {
        Row: {
          created_at: string
          decision: string | null
          id: string
          notes: string | null
          reviewer_id: string | null
          suggestion_id: string
        }
        Insert: {
          created_at?: string
          decision?: string | null
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          suggestion_id: string
        }
        Update: {
          created_at?: string
          decision?: string | null
          id?: string
          notes?: string | null
          reviewer_id?: string | null
          suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_reviews_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_similarities: {
        Row: {
          confirmed_duplicate: boolean
          created_at: string
          id: string
          reviewed_by: string | null
          similar_suggestion_id: string
          similarity_score: number
          source_suggestion_id: string
        }
        Insert: {
          confirmed_duplicate?: boolean
          created_at?: string
          id?: string
          reviewed_by?: string | null
          similar_suggestion_id: string
          similarity_score?: number
          source_suggestion_id: string
        }
        Update: {
          confirmed_duplicate?: boolean
          created_at?: string
          id?: string
          reviewed_by?: string | null
          similar_suggestion_id?: string
          similarity_score?: number
          source_suggestion_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_similarities_similar_suggestion_id_fkey"
            columns: ["similar_suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestion_similarities_source_suggestion_id_fkey"
            columns: ["source_suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_updates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          suggestion_id: string
          update_text_ar: string
          update_text_en: string
          update_type: string
          visible_to_student: boolean
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          suggestion_id: string
          update_text_ar: string
          update_text_en: string
          update_type?: string
          visible_to_student?: boolean
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          suggestion_id?: string
          update_text_ar?: string
          update_text_en?: string
          update_type?: string
          visible_to_student?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_updates_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestion_votes: {
        Row: {
          created_at: string
          id: string
          student_id: string
          suggestion_id: string
          vote_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          student_id: string
          suggestion_id: string
          vote_type?: string
        }
        Update: {
          created_at?: string
          id?: string
          student_id?: string
          suggestion_id?: string
          vote_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestion_votes_suggestion_id_fkey"
            columns: ["suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          affected_service_id: string | null
          assigned_staff_id: string | null
          category: string | null
          created_at: string
          deleted_at: string | null
          deletion_type: string | null
          description: string
          duplicate_of_suggestion_id: string | null
          entry_channel: string
          expected_benefit: string | null
          id: string
          implementation_target_date: string | null
          is_anonymous: boolean
          is_demo: boolean
          language: Database["public"]["Enums"]["lang_code"]
          outcome_summary: string | null
          reference_number: string
          related_conversation_id: string | null
          review_due_at: string | null
          routing_confidence: number | null
          routing_reason_ar: string | null
          routing_reason_en: string | null
          routing_service_code: string | null
          service_unit_id: string | null
          status: Database["public"]["Enums"]["suggestion_status"]
          student_hidden_at: string | null
          student_hidden_by: string | null
          student_id: string
          title: string
          updated_at: string
          vote_count: number
        }
        Insert: {
          affected_service_id?: string | null
          assigned_staff_id?: string | null
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_type?: string | null
          description: string
          duplicate_of_suggestion_id?: string | null
          entry_channel?: string
          expected_benefit?: string | null
          id?: string
          implementation_target_date?: string | null
          is_anonymous?: boolean
          is_demo?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          outcome_summary?: string | null
          reference_number: string
          related_conversation_id?: string | null
          review_due_at?: string | null
          routing_confidence?: number | null
          routing_reason_ar?: string | null
          routing_reason_en?: string | null
          routing_service_code?: string | null
          service_unit_id?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          student_hidden_at?: string | null
          student_hidden_by?: string | null
          student_id: string
          title: string
          updated_at?: string
          vote_count?: number
        }
        Update: {
          affected_service_id?: string | null
          assigned_staff_id?: string | null
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          deletion_type?: string | null
          description?: string
          duplicate_of_suggestion_id?: string | null
          entry_channel?: string
          expected_benefit?: string | null
          id?: string
          implementation_target_date?: string | null
          is_anonymous?: boolean
          is_demo?: boolean
          language?: Database["public"]["Enums"]["lang_code"]
          outcome_summary?: string | null
          reference_number?: string
          related_conversation_id?: string | null
          review_due_at?: string | null
          routing_confidence?: number | null
          routing_reason_ar?: string | null
          routing_reason_en?: string | null
          routing_service_code?: string | null
          service_unit_id?: string | null
          status?: Database["public"]["Enums"]["suggestion_status"]
          student_hidden_at?: string | null
          student_hidden_by?: string | null
          student_id?: string
          title?: string
          updated_at?: string
          vote_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_affected_service_id_fkey"
            columns: ["affected_service_id"]
            isOneToOne: false
            referencedRelation: "university_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_duplicate_of_suggestion_id_fkey"
            columns: ["duplicate_of_suggestion_id"]
            isOneToOne: false
            referencedRelation: "suggestions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_calls: {
        Row: {
          agent_run_id: string
          arguments: Json
          created_at: string
          id: string
          result: Json | null
          tool_name: string
          user_id: string
        }
        Insert: {
          agent_run_id: string
          arguments?: Json
          created_at?: string
          id?: string
          result?: Json | null
          tool_name: string
          user_id: string
        }
        Update: {
          agent_run_id?: string
          arguments?: Json
          created_at?: string
          id?: string
          result?: Json | null
          tool_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      universities: {
        Row: {
          country: string
          created_at: string
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          short_name: string
          timezone: string
          updated_at: string
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar: string
          name_en: string
          short_name: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          short_name?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      university_colleges: {
        Row: {
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name_ar: string | null
          name_en: string
          source_url: string | null
          updated_at: string
          verified_at: string
          web_source_id: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en: string
          source_url?: string | null
          updated_at?: string
          verified_at?: string
          web_source_id?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name_ar?: string | null
          name_en?: string
          source_url?: string | null
          updated_at?: string
          verified_at?: string
          web_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "university_colleges_web_source_id_fkey"
            columns: ["web_source_id"]
            isOneToOne: false
            referencedRelation: "web_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      university_services: {
        Row: {
          allows_agent_submission: boolean
          allows_online_submission: boolean
          authentication_required: boolean
          category: string
          code: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          estimated_processing_days: number
          id: string
          instructions_ar: string | null
          instructions_en: string | null
          is_active: boolean
          name_ar: string
          name_en: string
          requires_human_approval: boolean
          risk_level: Database["public"]["Enums"]["action_risk"]
          service_level_hours: number
          service_unit_id: string | null
          target_audience: string
          updated_at: string
        }
        Insert: {
          allows_agent_submission?: boolean
          allows_online_submission?: boolean
          authentication_required?: boolean
          category?: string
          code: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimated_processing_days?: number
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          name_ar: string
          name_en: string
          requires_human_approval?: boolean
          risk_level?: Database["public"]["Enums"]["action_risk"]
          service_level_hours?: number
          service_unit_id?: string | null
          target_audience?: string
          updated_at?: string
        }
        Update: {
          allows_agent_submission?: boolean
          allows_online_submission?: boolean
          authentication_required?: boolean
          category?: string
          code?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimated_processing_days?: number
          id?: string
          instructions_ar?: string | null
          instructions_en?: string | null
          is_active?: boolean
          name_ar?: string
          name_en?: string
          requires_human_approval?: boolean
          risk_level?: Database["public"]["Enums"]["action_risk"]
          service_level_hours?: number
          service_unit_id?: string | null
          target_audience?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "university_services_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      web_knowledge_sources: {
        Row: {
          allowed_path_pattern: string | null
          allowed_paths: Json
          approval_status: string
          change_detected: boolean
          chunk_count: number
          confidentiality_level: string
          content_hash: string | null
          crawl_scope: string
          created_at: string
          created_by: string | null
          excluded_path_patterns: Json
          extracted_text: string | null
          health_status: string
          id: string
          ingestion_status: string
          is_active: boolean
          knowledge_domain: string | null
          language: string
          last_changed_at: string | null
          last_checked_at: string | null
          last_error: string | null
          last_indexed_at: string | null
          last_successful_fetch_at: string | null
          max_depth: number
          max_pages: number
          owner_unit_id: string | null
          pages_discovered: number
          pages_failed: number
          pages_indexed: number
          refresh_frequency: string
          search_vector: unknown
          seed_urls: Json
          source_category: string
          title: string
          trusted_auto_refresh: boolean
          updated_at: string
          url: string
        }
        Insert: {
          allowed_path_pattern?: string | null
          allowed_paths?: Json
          approval_status?: string
          change_detected?: boolean
          chunk_count?: number
          confidentiality_level?: string
          content_hash?: string | null
          crawl_scope?: string
          created_at?: string
          created_by?: string | null
          excluded_path_patterns?: Json
          extracted_text?: string | null
          health_status?: string
          id?: string
          ingestion_status?: string
          is_active?: boolean
          knowledge_domain?: string | null
          language?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          last_indexed_at?: string | null
          last_successful_fetch_at?: string | null
          max_depth?: number
          max_pages?: number
          owner_unit_id?: string | null
          pages_discovered?: number
          pages_failed?: number
          pages_indexed?: number
          refresh_frequency?: string
          search_vector?: unknown
          seed_urls?: Json
          source_category?: string
          title: string
          trusted_auto_refresh?: boolean
          updated_at?: string
          url: string
        }
        Update: {
          allowed_path_pattern?: string | null
          allowed_paths?: Json
          approval_status?: string
          change_detected?: boolean
          chunk_count?: number
          confidentiality_level?: string
          content_hash?: string | null
          crawl_scope?: string
          created_at?: string
          created_by?: string | null
          excluded_path_patterns?: Json
          extracted_text?: string | null
          health_status?: string
          id?: string
          ingestion_status?: string
          is_active?: boolean
          knowledge_domain?: string | null
          language?: string
          last_changed_at?: string | null
          last_checked_at?: string | null
          last_error?: string | null
          last_indexed_at?: string | null
          last_successful_fetch_at?: string | null
          max_depth?: number
          max_pages?: number
          owner_unit_id?: string | null
          pages_discovered?: number
          pages_failed?: number
          pages_indexed?: number
          refresh_frequency?: string
          search_vector?: unknown
          seed_urls?: Json
          source_category?: string
          title?: string
          trusted_auto_refresh?: boolean
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_knowledge_sources_owner_unit_id_fkey"
            columns: ["owner_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      web_page_chunks: {
        Row: {
          chunk_index: number
          content: string
          content_hash: string | null
          created_at: string
          embedding: string | null
          fetched_at: string
          id: string
          indexed_at: string
          is_active: boolean
          language: string
          page_id: string
          page_title: string | null
          search_vector: unknown
          section_path: string | null
          section_title: string | null
          source_url: string
          token_count: number
          web_source_id: string
        }
        Insert: {
          chunk_index?: number
          content: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          fetched_at?: string
          id?: string
          indexed_at?: string
          is_active?: boolean
          language?: string
          page_id: string
          page_title?: string | null
          search_vector?: unknown
          section_path?: string | null
          section_title?: string | null
          source_url: string
          token_count?: number
          web_source_id: string
        }
        Update: {
          chunk_index?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          embedding?: string | null
          fetched_at?: string
          id?: string
          indexed_at?: string
          is_active?: boolean
          language?: string
          page_id?: string
          page_title?: string | null
          search_vector?: unknown
          section_path?: string | null
          section_title?: string | null
          source_url?: string
          token_count?: number
          web_source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_page_chunks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "web_source_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "web_page_chunks_web_source_id_fkey"
            columns: ["web_source_id"]
            isOneToOne: false
            referencedRelation: "web_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      web_source_changes: {
        Row: {
          approved_at: string | null
          change_percentage: number | null
          change_summary: string | null
          change_type: string
          detected_at: string
          id: string
          new_content_hash: string | null
          previous_content_hash: string | null
          review_status: string
          reviewed_by: string | null
          web_source_id: string
        }
        Insert: {
          approved_at?: string | null
          change_percentage?: number | null
          change_summary?: string | null
          change_type?: string
          detected_at?: string
          id?: string
          new_content_hash?: string | null
          previous_content_hash?: string | null
          review_status?: string
          reviewed_by?: string | null
          web_source_id: string
        }
        Update: {
          approved_at?: string | null
          change_percentage?: number | null
          change_summary?: string | null
          change_type?: string
          detected_at?: string
          id?: string
          new_content_hash?: string | null
          previous_content_hash?: string | null
          review_status?: string
          reviewed_by?: string | null
          web_source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_source_changes_web_source_id_fkey"
            columns: ["web_source_id"]
            isOneToOne: false
            referencedRelation: "web_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      web_source_pages: {
        Row: {
          chunk_count: number
          content_hash: string | null
          created_at: string
          depth: number
          error_reason: string | null
          fetched_at: string | null
          id: string
          indexed_at: string | null
          is_active: boolean
          language: string
          status: string
          text_length: number
          title: string | null
          updated_at: string
          url: string
          web_source_id: string
        }
        Insert: {
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          depth?: number
          error_reason?: string | null
          fetched_at?: string | null
          id?: string
          indexed_at?: string | null
          is_active?: boolean
          language?: string
          status?: string
          text_length?: number
          title?: string | null
          updated_at?: string
          url: string
          web_source_id: string
        }
        Update: {
          chunk_count?: number
          content_hash?: string | null
          created_at?: string
          depth?: number
          error_reason?: string | null
          fetched_at?: string | null
          id?: string
          indexed_at?: string | null
          is_active?: boolean
          language?: string
          status?: string
          text_length?: number
          title?: string | null
          updated_at?: string
          url?: string
          web_source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "web_source_pages_web_source_id_fkey"
            columns: ["web_source_id"]
            isOneToOne: false
            referencedRelation: "web_knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      working_calendars: {
        Row: {
          created_at: string
          id: string
          is_default: boolean
          name: string
          timezone: string
          university_id: string | null
          updated_at: string
          working_days: Json
          working_end_time: string
          working_start_time: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          timezone?: string
          university_id?: string | null
          updated_at?: string
          working_days?: Json
          working_end_time?: string
          working_start_time?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          timezone?: string
          university_id?: string | null
          updated_at?: string
          working_days?: Json
          working_end_time?: string
          working_start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "working_calendars_university_id_fkey"
            columns: ["university_id"]
            isOneToOne: false
            referencedRelation: "universities"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      case_monitor_v: {
        Row: {
          acknowledged_at: string | null
          actor: string | null
          alert_type: string | null
          assigned_to: string | null
          automation_level: string | null
          breach_seconds: number | null
          case_number: string | null
          case_type: Database["public"]["Enums"]["case_type"] | null
          closed_at: string | null
          closure_incomplete: boolean | null
          created_at: string | null
          critical_alert: boolean | null
          due_at: string | null
          escalated_at: string | null
          escalation_level: number | null
          escalation_unresolved: boolean | null
          first_response_due_at: string | null
          id: string | null
          inactive_seconds: number | null
          is_closed: boolean | null
          is_sensitive: boolean | null
          last_activity_at: string | null
          next_action_ar: string | null
          next_action_en: string | null
          owner_name: string | null
          owner_response_due_at: string | null
          owner_response_hours: number | null
          pause_on_student: boolean | null
          reopened_count: number | null
          resolution_communicated_at: string | null
          resolution_due_at: string | null
          resolved_at: string | null
          response_overdue: boolean | null
          response_state: string | null
          responsible_since: string | null
          root_cause_code: string | null
          routing_service_code: string | null
          routing_topic: string | null
          sensitivity_level: string | null
          service_unit_id: string | null
          severity: string | null
          sla_due_at: string | null
          sla_paused: boolean | null
          sla_paused_at: string | null
          sla_paused_minutes: number | null
          sla_status: string | null
          stall_hours: number | null
          stalled: boolean | null
          status: Database["public"]["Enums"]["case_status"] | null
          student_id: string | null
          student_name: string | null
          student_number: string | null
          title: string | null
          unit_code: string | null
          unit_name_ar: string | null
          unit_name_en: string | null
          updated_at: string | null
          urgency: Database["public"]["Enums"]["urgency_level"] | null
          waiting_seconds: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_workload_summary: {
        Row: {
          active_cases: number | null
          available_capacity: number | null
          high_priority_cases: number | null
          last_assignment_at: string | null
          overdue_cases: number | null
          service_unit_id: string | null
          staff_profile_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_profiles_service_unit_id_fkey"
            columns: ["service_unit_id"]
            isOneToOne: false
            referencedRelation: "service_units"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_case_monitor: {
        Args: {
          _actor?: string
          _escalation?: string
          _owner?: string
          _page?: number
          _page_size?: number
          _priority?: string
          _search?: string
          _since?: string
          _sla?: string
          _sort?: string
          _status?: string
          _type?: string
          _unit?: string
          _view?: string
        }
        Returns: Json
      }
      admin_case_monitor_detail: { Args: { _case_id: string }; Returns: Json }
      admin_case_monitor_summary: { Args: never; Returns: Json }
      admin_governance_overview: { Args: never; Returns: Json }
      admin_governance_report: {
        Args: {
          _from?: string
          _owner?: string
          _status?: string
          _to?: string
          _type?: string
          _unit?: string
        }
        Returns: Json
      }
      admin_owner_monitor: { Args: never; Returns: Json }
      admin_owner_performance: { Args: never; Returns: Json }
      admin_unit_monitor: { Args: never; Returns: Json }
      book_appointment_slot: {
        Args: { _purpose?: string; _slot_id: string }
        Returns: {
          appointment_slot_id: string
          booked_by: string | null
          cancelled_at: string | null
          case_id: string | null
          confirmation_code: string
          created_at: string
          id: string
          purpose: string | null
          status: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "student_appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      burn_verification_token: {
        Args: { _document_id: string }
        Returns: undefined
      }
      can_access_case: {
        Args: { _case_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_knowledge_file: {
        Args: { _name: string; _user_id: string }
        Returns: boolean
      }
      can_approve_knowledge: { Args: { _user_id: string }; Returns: boolean }
      can_manage_integrations: { Args: { _user_id: string }; Returns: boolean }
      can_manage_knowledge: { Args: { _user_id: string }; Returns: boolean }
      can_monitor_all_units: { Args: { _user_id: string }; Returns: boolean }
      can_monitor_cases: { Args: { _user_id: string }; Returns: boolean }
      can_read_case_evidence: {
        Args: { _name: string; _user_id: string }
        Returns: boolean
      }
      can_see_all_cases: { Args: { _user_id: string }; Returns: boolean }
      can_write_case_evidence: {
        Args: { _name: string; _user_id: string }
        Returns: boolean
      }
      cancel_appointment_booking: {
        Args: { _appointment_id: string; _reason?: string }
        Returns: {
          appointment_slot_id: string
          booked_by: string | null
          cancelled_at: string | null
          case_id: string | null
          confirmation_code: string
          created_at: string
          id: string
          purpose: string | null
          status: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "student_appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      case_monitor_units: {
        Args: { _user_id: string }
        Returns: {
          service_unit_id: string
        }[]
      }
      change_internship_assignment: {
        Args: {
          _assignment_id: string
          _new_opportunity_id: string
          _reason: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by_agent_run_id: string | null
          assigned_by_type: string
          assignment_number: string
          assignment_status: string
          course_registration_status: string
          created_at: string
          employer_acceptance_status: string
          final_allocation_at: string | null
          government_clearance_approved_at: string | null
          government_clearance_approved_by: string | null
          government_clearance_rejection_reason: string | null
          government_clearance_required: boolean
          government_clearance_status: string
          human_review_reason: string | null
          id: string
          internship_course_id: string | null
          internship_end_date: string | null
          internship_start_date: string | null
          match_explanation_id: string | null
          match_score: number | null
          opportunity_id: string
          organization_id: string
          owner_flagged: boolean
          owner_notes: string | null
          owner_review_status: string
          provisional_allocation_at: string | null
          related_case_id: string | null
          related_conversation_id: string | null
          requires_human_review: boolean
          seats_after: number | null
          seats_before: number | null
          service_owner_id: string | null
          student_confirmed_at: string | null
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "internship_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      check_intercollege_transfer_eligibility: {
        Args: { _student_id: string; _target_programme_id?: string }
        Returns: Json
      }
      check_intercollege_transfer_history: {
        Args: { _student_id: string }
        Returns: Json
      }
      claim_notification_deliveries: {
        Args: { _limit?: number }
        Returns: {
          action_url: string | null
          case_id: string | null
          channel: string
          created_at: string
          dedupe_key: string | null
          delivered_at: string | null
          emergency_broadcast_id: string | null
          event_type: string
          failed_at: string | null
          failure_code: string | null
          failure_reason: string | null
          id: string
          language: string
          locked_at: string | null
          next_attempt_at: string
          notification_event_id: string | null
          provider_message_id: string | null
          queued_at: string
          recipient_email: string | null
          recipient_role: string | null
          recipient_user_id: string | null
          retry_count: number
          sent_at: string | null
          service_unit_id: string | null
          severity: Database["public"]["Enums"]["notification_severity"]
          status: string
          subject: string | null
          template_code: string
          template_vars: Json
          template_version: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      decide_internship_clearance: {
        Args: { _assignment_id: string; _decision: string; _reason?: string }
        Returns: {
          assigned_at: string | null
          assigned_by_agent_run_id: string | null
          assigned_by_type: string
          assignment_number: string
          assignment_status: string
          course_registration_status: string
          created_at: string
          employer_acceptance_status: string
          final_allocation_at: string | null
          government_clearance_approved_at: string | null
          government_clearance_approved_by: string | null
          government_clearance_rejection_reason: string | null
          government_clearance_required: boolean
          government_clearance_status: string
          human_review_reason: string | null
          id: string
          internship_course_id: string | null
          internship_end_date: string | null
          internship_start_date: string | null
          match_explanation_id: string | null
          match_score: number | null
          opportunity_id: string
          organization_id: string
          owner_flagged: boolean
          owner_notes: string | null
          owner_review_status: string
          provisional_allocation_at: string | null
          related_case_id: string | null
          related_conversation_id: string | null
          requires_human_review: boolean
          seats_after: number | null
          seats_before: number | null
          service_owner_id: string | null
          student_confirmed_at: string | null
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "internship_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_my_issued_document: {
        Args: { _document_id: string }
        Returns: Json
      }
      evaluation_metrics: {
        Args: { _from?: string; _to?: string }
        Returns: Json
      }
      execute_intercollege_transfer: {
        Args: { _fingerprint: string; _request_id: string }
        Returns: {
          acknowledgement_version: string | null
          additional_credits_required: number
          analysis_snapshot: Json
          analysis_version: string | null
          capacity_id: string | null
          completed_credits: number
          created_at: string
          current_gpa: number | null
          eligibility_reasons: Json
          eligibility_status: string
          equivalency_version: string | null
          estimated_delay_semesters: number
          executed_at: string | null
          expected_graduation_before: string | null
          human_review_reason: string | null
          id: string
          non_applicable_credits: number
          owner_notes: string | null
          projected_gpa: number | null
          projected_graduation_after: string | null
          requires_human_review: boolean
          retained_credits: number
          rule_version: string | null
          seats_after: number | null
          seats_before: number | null
          source_college_id: string | null
          source_programme_id: string | null
          student_confirmed_at: string | null
          student_id: string
          target_college_id: string | null
          target_programme_id: string | null
          transfer_count_before: number
          transfer_number: string | null
          transfer_status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "intercollege_transfer_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      expire_student_documents: {
        Args: { _limit?: number }
        Returns: {
          file_path: string
          id: string
          reference_number: string
        }[]
      }
      generate_availability_slots: {
        Args: { _rule_id: string; _weeks?: number }
        Returns: number
      }
      get_service_availability: {
        Args: { _at?: string; _service_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_access_revoked: { Args: { _user_id: string }; Returns: boolean }
      is_housing_staff: { Args: { _user_id: string }; Returns: boolean }
      is_internship_staff: { Args: { _user_id: string }; Returns: boolean }
      is_manager: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      list_appointment_availability: {
        Args: {
          _from?: string
          _limit?: number
          _to?: string
          _type_query?: string
          _unit_code?: string
        }
        Returns: {
          duration_minutes: number
          end_time: string
          location: string
          location_type: string
          meeting_link: string
          requires_approval: boolean
          seats_left: number
          slot_id: string
          staff_email: string
          staff_id: string
          staff_name: string
          start_time: string
          type_id: string
          type_name_ar: string
          type_name_en: string
          unit_code: string
          unit_email: string
          unit_id: string
          unit_name_ar: string
          unit_name_en: string
        }[]
      }
      move_hostel_allocation: {
        Args: { _allocation_id: string; _new_room_id: string; _reason: string }
        Returns: {
          allocated_at: string
          allocated_by_agent_run_id: string | null
          allocated_by_type: string
          allocation_number: string
          allocation_status: string
          bed_label: string | null
          created_at: string
          hostel_id: string
          housing_application_id: string
          id: string
          move_in_date: string | null
          move_out_date: string | null
          override_reason: string | null
          reviewed_at: string | null
          reviewed_by_owner_id: string | null
          room_id: string
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "housing_allocations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_appointments: {
        Args: { _include_past?: boolean }
        Returns: {
          appointment_id: string
          confirmation_code: string
          end_time: string
          location: string
          location_type: string
          meeting_link: string
          purpose: string
          slot_id: string
          staff_email: string
          staff_name: string
          start_time: string
          status: string
          type_name_ar: string
          type_name_en: string
          unit_code: string
          unit_email: string
          unit_name_ar: string
          unit_name_en: string
        }[]
      }
      next_document_reference: { Args: { _doc_code: string }; Returns: string }
      owned_service_units: {
        Args: { _user_id: string }
        Returns: {
          service_unit_id: string
        }[]
      }
      owns_case: {
        Args: { _case_id: string; _user_id: string }
        Returns: boolean
      }
      owns_service_unit: {
        Args: { _unit_id: string; _user_id: string }
        Returns: boolean
      }
      purge_expired_documents: {
        Args: { _limit?: number }
        Returns: {
          file_path: string
          id: string
          reference_number: string
        }[]
      }
      purge_my_issued_document: {
        Args: { _document_id: string }
        Returns: Json
      }
      remove_my_requests: {
        Args: { _case_ids?: string[]; _scope?: string }
        Returns: Json
      }
      remove_my_suggestions: {
        Args: { _scope?: string; _suggestion_ids?: string[] }
        Returns: Json
      }
      reschedule_appointment_booking: {
        Args: { _appointment_id: string; _new_slot_id: string }
        Returns: {
          appointment_slot_id: string
          booked_by: string | null
          cancelled_at: string | null
          case_id: string | null
          confirmation_code: string
          created_at: string
          id: string
          purpose: string | null
          status: string
          student_id: string
        }
        SetofOptions: {
          from: "*"
          to: "student_appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_hostel_bed: {
        Args: {
          _agent_run_id?: string
          _allocated_by?: string
          _application_id: string
          _move_in: string
          _room_id: string
        }
        Returns: {
          allocated_at: string
          allocated_by_agent_run_id: string | null
          allocated_by_type: string
          allocation_number: string
          allocation_status: string
          bed_label: string | null
          created_at: string
          hostel_id: string
          housing_application_id: string
          id: string
          move_in_date: string | null
          move_out_date: string | null
          override_reason: string | null
          reviewed_at: string | null
          reviewed_by_owner_id: string | null
          room_id: string
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "housing_allocations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_internship_seat: {
        Args: {
          _agent_run_id?: string
          _assigned_by?: string
          _match_explanation_id?: string
          _match_score?: number
          _opportunity_id: string
        }
        Returns: {
          assigned_at: string | null
          assigned_by_agent_run_id: string | null
          assigned_by_type: string
          assignment_number: string
          assignment_status: string
          course_registration_status: string
          created_at: string
          employer_acceptance_status: string
          final_allocation_at: string | null
          government_clearance_approved_at: string | null
          government_clearance_approved_by: string | null
          government_clearance_rejection_reason: string | null
          government_clearance_required: boolean
          government_clearance_status: string
          human_review_reason: string | null
          id: string
          internship_course_id: string | null
          internship_end_date: string | null
          internship_start_date: string | null
          match_explanation_id: string | null
          match_score: number | null
          opportunity_id: string
          organization_id: string
          owner_flagged: boolean
          owner_notes: string | null
          owner_review_status: string
          provisional_allocation_at: string | null
          related_case_id: string | null
          related_conversation_id: string | null
          requires_human_review: boolean
          seats_after: number | null
          seats_before: number | null
          service_owner_id: string | null
          student_confirmed_at: string | null
          student_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "internship_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_knowledge_passages: {
        Args: {
          p_candidates?: number
          p_clearance?: number
          p_domain?: string
          p_lang?: string
          p_limit?: number
          p_query: string
          p_query_embedding?: string
          p_section_terms?: string[]
        }
        Returns: {
          authority: number
          chunk_id: string
          citation_url: string
          confidentiality: string
          document_type: string
          effective_date: string
          fuzzy_score: number
          knowledge_domain: string
          language: string
          lexical_score: number
          owning_unit: string
          page_number: number
          score: number
          section_title: string
          semantic_score: number
          snippet: string
          source_id: string
          source_type: string
          stale: boolean
          title: string
          version: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      staff_can_view_profile: {
        Args: { _profile: string; _viewer: string }
        Returns: boolean
      }
      staff_unit: { Args: { _user_id: string }; Returns: string }
      verify_student_document: {
        Args: { _client_hash: string; _token: string }
        Returns: Json
      }
    }
    Enums: {
      action_risk: "level_0" | "level_1" | "level_2" | "level_3"
      app_role:
        | "student"
        | "service_officer"
        | "service_manager"
        | "knowledge_manager"
        | "system_admin"
        | "auditor"
        | "leadership_viewer"
        | "integration_admin"
        | "knowledge_approver"
        | "service_owner"
      case_status:
        | "draft"
        | "submitted"
        | "acknowledged"
        | "assigned"
        | "in_review"
        | "awaiting_student"
        | "resolution_proposed"
        | "escalated"
        | "resolved"
        | "closed"
        | "classified"
        | "routed"
        | "in_progress"
        | "student_confirmation"
        | "rejected"
        | "withdrawn"
        | "duplicate"
        | "reopened"
        | "transferred"
        | "on_hold"
        | "ai_processing"
        | "waiting_external"
        | "placement_allocated"
      case_type:
        | "query"
        | "complaint"
        | "suggestion"
        | "service_request"
        | "alert"
      doc_status: "pending" | "processing" | "completed" | "failed"
      lang_code: "en" | "ar"
      notification_severity: "normal" | "important" | "critical" | "emergency"
      suggestion_status:
        | "draft"
        | "submitted"
        | "under_review"
        | "assigned"
        | "planned"
        | "implemented"
        | "closed"
        | "not_proceeding"
      urgency_level: "low" | "medium" | "high" | "critical"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      action_risk: ["level_0", "level_1", "level_2", "level_3"],
      app_role: [
        "student",
        "service_officer",
        "service_manager",
        "knowledge_manager",
        "system_admin",
        "auditor",
        "leadership_viewer",
        "integration_admin",
        "knowledge_approver",
        "service_owner",
      ],
      case_status: [
        "draft",
        "submitted",
        "acknowledged",
        "assigned",
        "in_review",
        "awaiting_student",
        "resolution_proposed",
        "escalated",
        "resolved",
        "closed",
        "classified",
        "routed",
        "in_progress",
        "student_confirmation",
        "rejected",
        "withdrawn",
        "duplicate",
        "reopened",
        "transferred",
        "on_hold",
        "ai_processing",
        "waiting_external",
        "placement_allocated",
      ],
      case_type: [
        "query",
        "complaint",
        "suggestion",
        "service_request",
        "alert",
      ],
      doc_status: ["pending", "processing", "completed", "failed"],
      lang_code: ["en", "ar"],
      notification_severity: ["normal", "important", "critical", "emergency"],
      suggestion_status: [
        "draft",
        "submitted",
        "under_review",
        "assigned",
        "planned",
        "implemented",
        "closed",
        "not_proceeding",
      ],
      urgency_level: ["low", "medium", "high", "critical"],
    },
  },
} as const
