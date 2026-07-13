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

ActiveRecord::Schema[8.0].define(version: 2026_07_12_180000) do
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
  end

  create_table "messages", force: :cascade do |t|
    t.bigint "conversation_id", null: false
    t.string "role", null: false
    t.text "content"
    t.integer "tokens_count", default: 0
    t.jsonb "metadata", default: {}
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["conversation_id", "created_at"], name: "index_messages_on_conversation_id_and_created_at"
    t.index ["conversation_id"], name: "index_messages_on_conversation_id"
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

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
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
end
