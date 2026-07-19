# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.0].define(version: 2026_07_19_202000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.string "name", null: false
    t.string "record_type", null: false
    t.bigint "record_id", null: false
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.string "key", null: false
    t.string "filename", null: false
    t.string "content_type"
    t.text "metadata"
    t.string "service_name", null: false
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "agent_tasks", force: :cascade do |t|
    t.bigint "project_id", null: false
    t.string "task_key", null: false
    t.string "status", default: "awaiting_grant", null: false
    t.text "intended_outcome", null: false
    t.jsonb "success_criteria", default: [], null: false
    t.jsonb "verification_criteria", default: [], null: false
    t.jsonb "plan", default: {}, null: false
    t.jsonb "context_snapshot", default: {}, null: false
    t.jsonb "repository_snapshot", default: {}, null: false
    t.text "recommended_next_action"
    t.text "outcome_summary"
    t.jsonb "verification_result", default: {}, null: false
    t.bigint "revision", default: 0, null: false
    t.datetime "started_at"
    t.datetime "completed_at"
    t.datetime "cancelled_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["project_id"], name: "index_agent_tasks_on_project_id"
    t.index ["project_id"], name: "index_agent_tasks_one_unfinished_per_project", unique: true, where: "((status)::text = ANY ((ARRAY['awaiting_grant'::character varying, 'ready'::character varying, 'running'::character varying, 'blocked'::character varying])::text[]))"
    t.index ["task_key"], name: "index_agent_tasks_on_task_key", unique: true
    t.check_constraint "revision >= 0", name: "agent_tasks_revision_check"
    t.check_constraint "status::text = ANY (ARRAY['awaiting_grant'::character varying, 'ready'::character varying, 'running'::character varying, 'blocked'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying]::text[])", name: "agent_tasks_status_check"
  end

  create_table "artifacts", force: :cascade do |t|
    t.bigint "scene_id", null: false
    t.bigint "project_id"
    t.bigint "context_id"
    t.bigint "conversation_id"
    t.bigint "build_id"
    t.string "kind", null: false
    t.string "status", default: "ready", null: false
    t.string "title", null: false
    t.text "content"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["build_id"], name: "index_artifacts_on_build_id"
    t.index ["context_id"], name: "index_artifacts_on_context_id"
    t.index ["conversation_id"], name: "index_artifacts_on_conversation_id"
    t.index ["kind", "status"], name: "index_artifacts_on_kind_and_status"
    t.index ["project_id"], name: "index_artifacts_on_project_id"
    t.index ["scene_id", "created_at"], name: "index_artifacts_on_scene_id_and_created_at"
    t.index ["scene_id"], name: "index_artifacts_on_scene_id"
  end

  create_table "behaviours", force: :cascade do |t|
    t.string "name"
    t.string "trigger_phrase"
    t.text "description"
    t.jsonb "steps"
    t.integer "success_count"
    t.integer "failure_count"
    t.datetime "last_used_at"
    t.bigint "project_id"
    t.float "decay_score"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["project_id"], name: "index_behaviours_on_project_id"
  end

  create_table "beliefs", force: :cascade do |t|
    t.text "statement"
    t.float "confidence", default: 0.5, null: false
    t.bigint "project_id"
    t.string "status"
    t.float "decay_score"
    t.datetime "last_used_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.jsonb "source_decision_ids", default: [], null: false
    t.index ["project_id"], name: "index_beliefs_on_project_id"
  end

  create_table "builds", force: :cascade do |t|
    t.bigint "project_id", null: false
    t.bigint "conversation_id", null: false
    t.string "status"
    t.jsonb "context_snapshot"
    t.text "output"
    t.text "outcome_summary"
    t.datetime "started_at"
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "scene_id"
    t.bigint "artifact_id"
    t.bigint "requested_by_surface_item_id"
    t.text "instructions"
    t.text "confirmation_summary"
    t.datetime "confirmed_at"
    t.index ["artifact_id"], name: "index_builds_on_artifact_id"
    t.index ["conversation_id"], name: "index_builds_on_conversation_id"
    t.index ["project_id"], name: "index_builds_on_project_id"
    t.index ["requested_by_surface_item_id"], name: "index_builds_on_requested_by_surface_item_id"
    t.index ["scene_id"], name: "index_builds_on_scene_id"
  end

  create_table "capture_imports", force: :cascade do |t|
    t.string "source_file"
    t.string "content_hash"
    t.string "project"
    t.datetime "timestamp"
    t.string "session_id"
    t.string "source_type"
    t.text "body"
    t.datetime "imported_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["content_hash"], name: "index_capture_imports_on_content_hash", unique: true
    t.index ["source_file"], name: "index_capture_imports_on_source_file"
  end

  create_table "context_corrections", force: :cascade do |t|
    t.bigint "intent_id"
    t.bigint "surface_item_id"
    t.jsonb "original_contexts", default: [], null: false
    t.jsonb "corrected_contexts", default: [], null: false
    t.text "reason"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["intent_id"], name: "index_context_corrections_on_intent_id"
    t.index ["surface_item_id"], name: "index_context_corrections_on_surface_item_id"
  end

  create_table "contexts", force: :cascade do |t|
    t.string "name", null: false
    t.string "kind", default: "temporary", null: false
    t.text "description"
    t.string "status", default: "active", null: false
    t.datetime "expires_at"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_contexts_on_expires_at"
    t.index ["kind", "name"], name: "index_contexts_on_kind_and_name"
    t.index ["status"], name: "index_contexts_on_status"
  end

  create_table "conversations", force: :cascade do |t|
    t.bigint "project_id"
    t.string "status", default: "active"
    t.text "summary"
    t.boolean "active", default: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "context_id"
    t.bigint "superseded_by_conversation_id"
    t.index ["context_id"], name: "idx_conversations_one_active_per_context", unique: true, where: "(active = true)"
    t.index ["context_id"], name: "index_conversations_on_context_id"
    t.index ["project_id", "active"], name: "index_conversations_on_project_id_and_active"
    t.index ["project_id"], name: "idx_conversations_one_active_per_project", unique: true, where: "(active = true)"
    t.index ["project_id"], name: "index_conversations_on_project_id"
    t.index ["superseded_by_conversation_id"], name: "index_conversations_on_superseded_by_conversation_id"
  end

  create_table "decisions", force: :cascade do |t|
    t.bigint "conversation_id", null: false
    t.bigint "project_id", null: false
    t.text "content"
    t.bigint "source_message_id"
    t.float "confidence", default: 0.5
    t.datetime "extracted_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.float "decay_score"
    t.datetime "last_used_at"
    t.string "decay_type"
    t.index ["conversation_id"], name: "index_decisions_on_conversation_id"
    t.index ["extracted_at"], name: "index_decisions_on_extracted_at"
    t.index ["project_id"], name: "index_decisions_on_project_id"
    t.index ["source_message_id"], name: "index_decisions_on_source_message_id"
  end

  create_table "intelligence_snapshots", force: :cascade do |t|
    t.string "provider", null: false
    t.string "schema_version", null: false
    t.string "status", default: "fresh", null: false
    t.datetime "generated_at"
    t.datetime "received_at", null: false
    t.datetime "fresh_until"
    t.string "state_digest", null: false
    t.jsonb "payload", default: {}, null: false
    t.jsonb "provider_errors", default: [], null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["fresh_until"], name: "index_intelligence_snapshots_on_fresh_until"
    t.index ["provider", "created_at"], name: "index_intelligence_snapshots_on_provider_and_created_at"
    t.index ["provider", "state_digest"], name: "index_intelligence_snapshots_on_provider_and_state_digest", unique: true
    t.index ["status"], name: "index_intelligence_snapshots_on_status"
  end

  create_table "intent_attachments", force: :cascade do |t|
    t.bigint "intent_id", null: false
    t.string "modality", null: false
    t.string "filename"
    t.string "content_type"
    t.bigint "byte_size", default: 0, null: false
    t.string "checksum"
    t.binary "data"
    t.text "extracted_text"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.datetime "expires_at"
    t.index ["checksum"], name: "index_intent_attachments_on_checksum"
    t.index ["expires_at"], name: "index_intent_attachments_on_expires_at"
    t.index ["intent_id", "checksum"], name: "index_intent_attachments_on_intent_id_and_checksum", unique: true
    t.index ["intent_id"], name: "index_intent_attachments_on_intent_id"
    t.index ["modality"], name: "index_intent_attachments_on_modality"
  end

  create_table "intents", force: :cascade do |t|
    t.text "input_text", null: false
    t.string "modality", default: "text", null: false
    t.string "status", default: "received", null: false
    t.jsonb "attachments", default: [], null: false
    t.jsonb "interpretation", default: {}, null: false
    t.jsonb "context_candidates", default: [], null: false
    t.jsonb "resolved_contexts", default: [], null: false
    t.string "requested_capability"
    t.bigint "origin_surface_id"
    t.bigint "result_surface_id"
    t.bigint "conversation_id"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["conversation_id"], name: "index_intents_on_conversation_id"
    t.index ["created_at"], name: "index_intents_on_created_at"
    t.index ["origin_surface_id"], name: "index_intents_on_origin_surface_id"
    t.index ["result_surface_id"], name: "index_intents_on_result_surface_id"
    t.index ["status"], name: "index_intents_on_status"
  end

  create_table "memory_edges", force: :cascade do |t|
    t.string "source_type", null: false
    t.integer "source_id", null: false
    t.string "target_type", null: false
    t.integer "target_id", null: false
    t.float "confidence"
    t.integer "citation_count"
    t.datetime "last_cited_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "relationship_type", default: "relates_to", null: false
    t.index ["relationship_type"], name: "index_memory_edges_on_relationship_type"
  end

  create_table "messages", force: :cascade do |t|
    t.bigint "conversation_id", null: false
    t.string "role", null: false
    t.text "content"
    t.integer "tokens_count", default: 0
    t.jsonb "metadata", default: {}
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "tool_call_id"
    t.string "name"
    t.index ["conversation_id", "created_at"], name: "index_messages_on_conversation_id_and_created_at"
    t.index ["conversation_id"], name: "index_messages_on_conversation_id"
    t.index ["tool_call_id"], name: "index_messages_on_tool_call_id"
  end

  create_table "projects", force: :cascade do |t|
    t.string "name"
    t.text "description"
    t.string "root_path"
    t.datetime "archived_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["archived_at"], name: "index_projects_on_archived_at"
    t.index ["name"], name: "index_projects_on_name", unique: true
  end

  create_table "runtime_delivery_states", force: :cascade do |t|
    t.string "listener_key", null: false
    t.bigint "last_event_id", default: 0, null: false
    t.string "lease_owner"
    t.datetime "lease_expires_at"
    t.datetime "last_received_at"
    t.datetime "last_delivered_at"
    t.integer "delivery_latency_ms"
    t.text "last_error"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["listener_key"], name: "index_runtime_delivery_states_on_listener_key", unique: true
    t.check_constraint "delivery_latency_ms IS NULL OR delivery_latency_ms >= 0", name: "runtime_delivery_states_latency_check"
    t.check_constraint "last_event_id >= 0", name: "runtime_delivery_states_cursor_check"
  end

  create_table "runtime_events", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.bigint "task_grant_id"
    t.bigint "worker_session_id"
    t.string "event_key", null: false
    t.string "event_type", null: false
    t.string "idempotency_key"
    t.bigint "task_revision", null: false
    t.jsonb "payload", default: {}, null: false
    t.datetime "occurred_at", null: false
    t.datetime "archive_delivered_at"
    t.datetime "broadcast_delivered_at"
    t.integer "delivery_attempts", default: 0, null: false
    t.datetime "next_delivery_at"
    t.text "last_delivery_error"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id", "task_revision"], name: "index_runtime_events_on_agent_task_id_and_task_revision", unique: true
    t.index ["agent_task_id"], name: "index_runtime_events_on_agent_task_id"
    t.index ["archive_delivered_at", "next_delivery_at"], name: "index_runtime_events_pending_archive"
    t.index ["event_key"], name: "index_runtime_events_on_event_key", unique: true
    t.index ["idempotency_key"], name: "index_runtime_events_on_idempotency_key", unique: true, where: "(idempotency_key IS NOT NULL)"
    t.index ["task_grant_id"], name: "index_runtime_events_on_task_grant_id"
    t.index ["worker_session_id"], name: "index_runtime_events_on_worker_session_id"
  end

  create_table "scenes", force: :cascade do |t|
    t.string "scene_key", null: false
    t.string "kind", default: "work", null: false
    t.string "status", default: "active", null: false
    t.string "title", null: false
    t.text "summary"
    t.text "desired_outcome"
    t.text "resolution_summary"
    t.bigint "project_id"
    t.bigint "context_id"
    t.bigint "conversation_id"
    t.bigint "intent_id"
    t.datetime "last_presented_at"
    t.datetime "resolved_at"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "resolved_artifact_id"
    t.index ["context_id"], name: "index_scenes_on_context_id"
    t.index ["conversation_id"], name: "index_scenes_on_conversation_id"
    t.index ["intent_id"], name: "index_scenes_on_intent_id"
    t.index ["project_id"], name: "index_scenes_on_project_id"
    t.index ["resolved_artifact_id"], name: "index_scenes_on_resolved_artifact_id"
    t.index ["scene_key"], name: "index_scenes_on_scene_key", unique: true
    t.index ["status", "updated_at"], name: "index_scenes_on_status_and_updated_at"
  end

  create_table "surface_composition_logs", force: :cascade do |t|
    t.bigint "surface_id"
    t.string "reason"
    t.string "state_digest"
    t.string "model"
    t.integer "input_characters"
    t.integer "output_characters"
    t.integer "latency_ms"
    t.string "status", null: false
    t.jsonb "provider_health", default: [], null: false
    t.jsonb "validation_errors", default: [], null: false
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["created_at"], name: "index_surface_composition_logs_on_created_at"
    t.index ["status"], name: "index_surface_composition_logs_on_status"
    t.index ["surface_id"], name: "index_surface_composition_logs_on_surface_id"
  end

  create_table "surface_feedbacks", force: :cascade do |t|
    t.bigint "surface_id", null: false
    t.bigint "surface_item_id"
    t.string "signal", null: false
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["surface_id", "signal"], name: "index_surface_feedbacks_on_surface_id_and_signal"
    t.index ["surface_id"], name: "index_surface_feedbacks_on_surface_id"
    t.index ["surface_item_id"], name: "index_surface_feedbacks_on_surface_item_id"
  end

  create_table "surface_items", force: :cascade do |t|
    t.bigint "surface_id", null: false
    t.string "item_key", null: false
    t.string "kind", null: false
    t.string "intent", null: false
    t.string "renderer", null: false
    t.string "depth", default: "middle", null: false
    t.string "state", default: "presented", null: false
    t.string "title", null: false
    t.text "summary"
    t.integer "position", default: 0, null: false
    t.jsonb "context_refs", default: [], null: false
    t.jsonb "source_refs", default: [], null: false
    t.jsonb "actions", default: [], null: false
    t.jsonb "relationships", default: [], null: false
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "scene_id"
    t.index ["scene_id"], name: "index_surface_items_on_scene_id"
    t.index ["surface_id", "item_key"], name: "index_surface_items_on_surface_id_and_item_key", unique: true
    t.index ["surface_id", "position"], name: "index_surface_items_on_surface_id_and_position"
    t.index ["surface_id"], name: "index_surface_items_on_surface_id"
  end

  create_table "surface_preferences", force: :cascade do |t|
    t.string "dimension", null: false
    t.string "value", null: false
    t.float "weight", default: 0.0, null: false
    t.integer "positive_count", default: 0, null: false
    t.integer "negative_count", default: 0, null: false
    t.datetime "last_observed_at"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["dimension", "value"], name: "index_surface_preferences_on_dimension_and_value", unique: true
    t.index ["weight"], name: "index_surface_preferences_on_weight"
  end

  create_table "surfaces", force: :cascade do |t|
    t.string "status", default: "draft", null: false
    t.text "understanding"
    t.text "current_intention"
    t.string "focus_item_key"
    t.datetime "generated_at"
    t.datetime "valid_until"
    t.string "source_state_digest"
    t.string "composition_version", default: "1", null: false
    t.bigint "previous_surface_id"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["previous_surface_id"], name: "index_surfaces_on_previous_surface_id"
    t.index ["source_state_digest"], name: "index_surfaces_on_source_state_digest"
    t.index ["status"], name: "index_surfaces_on_status"
    t.index ["status"], name: "index_surfaces_one_active", unique: true, where: "((status)::text = 'active'::text)"
    t.index ["valid_until"], name: "index_surfaces_on_valid_until"
  end

  create_table "task_artifacts", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.bigint "task_assignment_id"
    t.bigint "worker_session_id"
    t.string "artifact_key", null: false
    t.string "kind", null: false
    t.string "title", null: false
    t.string "media_type", null: false
    t.bigint "byte_size", null: false
    t.string "sha256_digest", null: false
    t.string "verification_status", default: "pending", null: false
    t.bigint "source_revision", null: false
    t.text "content"
    t.string "relative_path"
    t.string "repository_head"
    t.jsonb "provenance", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id", "source_revision"], name: "index_task_artifacts_on_agent_task_id_and_source_revision"
    t.index ["agent_task_id"], name: "index_task_artifacts_on_agent_task_id"
    t.index ["artifact_key"], name: "index_task_artifacts_on_artifact_key", unique: true
    t.index ["task_assignment_id"], name: "index_task_artifacts_on_task_assignment_id"
    t.index ["worker_session_id"], name: "index_task_artifacts_on_worker_session_id"
    t.check_constraint "byte_size >= 0", name: "task_artifacts_byte_size_check"
    t.check_constraint "kind::text = ANY (ARRAY['diff'::character varying, 'test'::character varying, 'log'::character varying, 'code'::character varying, 'image'::character varying, 'document'::character varying]::text[])", name: "task_artifacts_kind_check"
    t.check_constraint "source_revision >= 0", name: "task_artifacts_source_revision_check"
    t.check_constraint "verification_status::text = ANY (ARRAY['pending'::character varying, 'verified'::character varying, 'rejected'::character varying]::text[])", name: "task_artifacts_verification_status_check"
  end

  create_table "task_assignments", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.string "assignment_key", null: false
    t.string "status", default: "pending", null: false
    t.string "title", null: false
    t.text "instructions", null: false
    t.jsonb "success_criteria", default: [], null: false
    t.jsonb "capability_requirements", default: [], null: false
    t.jsonb "dependency_keys", default: [], null: false
    t.jsonb "declared_file_scope", default: [], null: false
    t.jsonb "excluded_adapters", default: [], null: false
    t.string "worktree_path"
    t.string "branch_name"
    t.string "base_head"
    t.jsonb "verification_result", default: {}, null: false
    t.jsonb "integration_result", default: {}, null: false
    t.bigint "revision", default: 1, null: false
    t.datetime "started_at"
    t.datetime "ended_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id", "status"], name: "index_task_assignments_on_agent_task_id_and_status"
    t.index ["agent_task_id"], name: "index_task_assignments_on_agent_task_id"
    t.index ["assignment_key"], name: "index_task_assignments_on_assignment_key", unique: true
    t.check_constraint "revision > 0", name: "task_assignments_revision_check"
    t.check_constraint "status::text = ANY (ARRAY['pending'::character varying, 'running'::character varying, 'verified'::character varying, 'blocked'::character varying, 'integrated'::character varying, 'failed'::character varying, 'cancelled'::character varying]::text[])", name: "task_assignments_status_check"
  end

  create_table "task_corrections", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.bigint "supersedes_task_correction_id"
    t.string "correction_key", null: false
    t.text "original_claim"
    t.text "corrected_value", null: false
    t.bigint "task_revision", null: false
    t.bigint "surface_revision"
    t.string "authority", default: "user", null: false
    t.jsonb "provenance", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id", "task_revision"], name: "index_task_corrections_on_agent_task_id_and_task_revision", unique: true
    t.index ["agent_task_id"], name: "index_task_corrections_on_agent_task_id"
    t.index ["correction_key"], name: "index_task_corrections_on_correction_key", unique: true
    t.index ["supersedes_task_correction_id"], name: "index_task_corrections_on_supersedes_task_correction_id"
    t.check_constraint "authority::text = 'user'::text", name: "task_corrections_authority_check"
    t.check_constraint "surface_revision IS NULL OR surface_revision >= 0", name: "task_corrections_surface_revision_check"
    t.check_constraint "task_revision >= 0", name: "task_corrections_revision_check"
  end

  create_table "task_grants", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.string "grant_key", null: false
    t.string "status", default: "proposed", null: false
    t.string "scope_digest", null: false
    t.jsonb "repository_roots", default: [], null: false
    t.jsonb "worktree_paths", default: [], null: false
    t.jsonb "worker_adapters", default: [], null: false
    t.jsonb "file_operations", default: [], null: false
    t.jsonb "command_classes", default: [], null: false
    t.jsonb "verification_commands", default: [], null: false
    t.jsonb "renewal_required_actions", default: [], null: false
    t.integer "max_concurrency", default: 1, null: false
    t.jsonb "budget", default: {}, null: false
    t.datetime "approved_at"
    t.datetime "expires_at", null: false
    t.datetime "ended_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "provider_identity", default: "opencode-configured-provider", null: false
    t.text "decision_reason"
    t.datetime "decided_at"
    t.index ["agent_task_id"], name: "index_task_grants_on_agent_task_id"
    t.index ["agent_task_id"], name: "index_task_grants_one_approved_per_task", unique: true, where: "((status)::text = 'approved'::text)"
    t.index ["grant_key"], name: "index_task_grants_on_grant_key", unique: true
    t.check_constraint "max_concurrency > 0", name: "task_grants_concurrency_check"
    t.check_constraint "status::text = ANY (ARRAY['proposed'::character varying, 'approved'::character varying, 'expired'::character varying, 'revoked'::character varying, 'exhausted'::character varying, 'completed'::character varying]::text[])", name: "task_grants_status_check"
  end

  create_table "task_sessions", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.string "session_key", null: false
    t.string "status", default: "active", null: false
    t.boolean "resumed", default: false, null: false
    t.string "interpretation_status", default: "pending", null: false
    t.boolean "manual_context_restatement", default: false, null: false
    t.boolean "tool_escape", default: false, null: false
    t.jsonb "startup_snapshot", default: {}, null: false
    t.datetime "started_at", null: false
    t.datetime "ended_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id"], name: "index_task_sessions_on_agent_task_id"
    t.index ["agent_task_id"], name: "index_task_sessions_one_active_per_task", unique: true, where: "((status)::text = 'active'::text)"
    t.index ["session_key"], name: "index_task_sessions_on_session_key", unique: true
    t.check_constraint "interpretation_status::text = ANY (ARRAY['pending'::character varying, 'accepted'::character varying, 'focused_corrected'::character varying, 'replaced'::character varying]::text[])", name: "task_sessions_interpretation_check"
    t.check_constraint "status::text = ANY (ARRAY['active'::character varying, 'ended'::character varying]::text[])", name: "task_sessions_status_check"
  end

  create_table "worker_commands", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.bigint "worker_session_id", null: false
    t.string "command_key", null: false
    t.string "kind", null: false
    t.string "status", default: "queued", null: false
    t.string "idempotency_key", null: false
    t.jsonb "payload", default: {}, null: false
    t.datetime "dispatched_at"
    t.datetime "completed_at"
    t.text "error_summary"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_task_id"], name: "index_worker_commands_on_agent_task_id"
    t.index ["command_key"], name: "index_worker_commands_on_command_key", unique: true
    t.index ["idempotency_key"], name: "index_worker_commands_on_idempotency_key", unique: true
    t.index ["worker_session_id", "status"], name: "index_worker_commands_on_worker_session_id_and_status"
    t.index ["worker_session_id"], name: "index_worker_commands_on_worker_session_id"
    t.check_constraint "kind::text = ANY (ARRAY['stop'::character varying, 'retry'::character varying, 'redirect'::character varying, 'replace'::character varying]::text[])", name: "worker_commands_kind_check"
    t.check_constraint "status::text = ANY (ARRAY['queued'::character varying, 'dispatched'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying]::text[])", name: "worker_commands_status_check"
  end

  create_table "worker_sessions", force: :cascade do |t|
    t.bigint "agent_task_id", null: false
    t.bigint "task_grant_id", null: false
    t.bigint "resumes_worker_session_id"
    t.string "worker_key", null: false
    t.string "status", default: "queued", null: false
    t.string "adapter", null: false
    t.string "executable_path"
    t.string "executable_version"
    t.string "working_directory", null: false
    t.string "external_session_id"
    t.bigint "process_id"
    t.integer "assignment_revision", default: 1, null: false
    t.datetime "last_heartbeat_at"
    t.datetime "started_at"
    t.datetime "ended_at"
    t.integer "exit_status"
    t.text "error_summary"
    t.text "output"
    t.jsonb "usage", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "task_assignment_id", null: false
    t.jsonb "capabilities", default: [], null: false
    t.datetime "last_observed_at"
    t.text "stop_reason"
    t.string "process_identity"
    t.index ["agent_task_id"], name: "index_worker_sessions_on_agent_task_id"
    t.index ["resumes_worker_session_id"], name: "index_worker_sessions_on_resumes_worker_session_id"
    t.index ["task_assignment_id"], name: "index_worker_sessions_on_task_assignment_id"
    t.index ["task_assignment_id"], name: "index_worker_sessions_one_live_per_assignment", unique: true, where: "((status)::text = ANY ((ARRAY['queued'::character varying, 'starting'::character varying, 'running'::character varying, 'stopping'::character varying])::text[]))"
    t.index ["task_grant_id"], name: "index_worker_sessions_on_task_grant_id"
    t.index ["worker_key"], name: "index_worker_sessions_on_worker_key", unique: true
    t.check_constraint "status::text = ANY (ARRAY['queued'::character varying, 'starting'::character varying, 'running'::character varying, 'stopping'::character varying, 'completed'::character varying, 'failed'::character varying, 'interrupted'::character varying, 'cancelled'::character varying, 'stopped'::character varying, 'replaced'::character varying]::text[])", name: "worker_sessions_status_check"
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "agent_tasks", "projects"
  add_foreign_key "artifacts", "builds"
  add_foreign_key "artifacts", "contexts"
  add_foreign_key "artifacts", "conversations"
  add_foreign_key "artifacts", "projects"
  add_foreign_key "artifacts", "scenes"
  add_foreign_key "behaviours", "projects"
  add_foreign_key "beliefs", "projects"
  add_foreign_key "builds", "artifacts"
  add_foreign_key "builds", "conversations"
  add_foreign_key "builds", "projects"
  add_foreign_key "builds", "scenes"
  add_foreign_key "builds", "surface_items", column: "requested_by_surface_item_id"
  add_foreign_key "context_corrections", "intents"
  add_foreign_key "context_corrections", "surface_items"
  add_foreign_key "conversations", "contexts"
  add_foreign_key "conversations", "conversations", column: "superseded_by_conversation_id"
  add_foreign_key "conversations", "projects"
  add_foreign_key "decisions", "conversations"
  add_foreign_key "decisions", "messages", column: "source_message_id"
  add_foreign_key "decisions", "projects"
  add_foreign_key "intent_attachments", "intents"
  add_foreign_key "intents", "conversations"
  add_foreign_key "intents", "surfaces", column: "origin_surface_id"
  add_foreign_key "intents", "surfaces", column: "result_surface_id"
  add_foreign_key "messages", "conversations"
  add_foreign_key "runtime_events", "agent_tasks"
  add_foreign_key "runtime_events", "task_grants"
  add_foreign_key "runtime_events", "worker_sessions"
  add_foreign_key "scenes", "artifacts", column: "resolved_artifact_id"
  add_foreign_key "scenes", "contexts"
  add_foreign_key "scenes", "conversations"
  add_foreign_key "scenes", "intents"
  add_foreign_key "scenes", "projects"
  add_foreign_key "surface_composition_logs", "surfaces"
  add_foreign_key "surface_feedbacks", "surface_items"
  add_foreign_key "surface_feedbacks", "surfaces"
  add_foreign_key "surface_items", "scenes"
  add_foreign_key "surface_items", "surfaces"
  add_foreign_key "surfaces", "surfaces", column: "previous_surface_id"
  add_foreign_key "task_artifacts", "agent_tasks"
  add_foreign_key "task_artifacts", "task_assignments"
  add_foreign_key "task_artifacts", "worker_sessions"
  add_foreign_key "task_assignments", "agent_tasks"
  add_foreign_key "task_corrections", "agent_tasks"
  add_foreign_key "task_corrections", "task_corrections", column: "supersedes_task_correction_id"
  add_foreign_key "task_grants", "agent_tasks"
  add_foreign_key "task_sessions", "agent_tasks"
  add_foreign_key "worker_commands", "agent_tasks"
  add_foreign_key "worker_commands", "worker_sessions"
  add_foreign_key "worker_sessions", "agent_tasks"
  add_foreign_key "worker_sessions", "task_assignments"
  add_foreign_key "worker_sessions", "task_grants"
  add_foreign_key "worker_sessions", "worker_sessions", column: "resumes_worker_session_id"
end
