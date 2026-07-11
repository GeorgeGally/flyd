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

ActiveRecord::Schema[8.0].define(version: 2026_07_12_100000) do
  enable_extension "pg_catalog.plpgsql"

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
    t.index ["conversation_id"], name: "index_builds_on_conversation_id"
    t.index ["project_id"], name: "index_builds_on_project_id"
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

  create_table "conversations", force: :cascade do |t|
    t.bigint "project_id", null: false
    t.string "status", default: "active"
    t.text "summary"
    t.boolean "active", default: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["project_id", "active"], name: "index_conversations_on_project_id_and_active"
    t.index ["project_id"], name: "idx_conversations_one_active_per_project", unique: true, where: "(active = true)"
    t.index ["project_id"], name: "index_conversations_on_project_id"
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
    t.index ["surface_id", "item_key"], name: "index_surface_items_on_surface_id_and_item_key", unique: true
    t.index ["surface_id", "position"], name: "index_surface_items_on_surface_id_and_position"
    t.index ["surface_id"], name: "index_surface_items_on_surface_id"
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

  add_foreign_key "behaviours", "projects"
  add_foreign_key "beliefs", "projects"
  add_foreign_key "builds", "conversations"
  add_foreign_key "builds", "projects"
  add_foreign_key "conversations", "projects"
  add_foreign_key "decisions", "conversations"
  add_foreign_key "decisions", "messages", column: "source_message_id"
  add_foreign_key "decisions", "projects"
  add_foreign_key "messages", "conversations"
  add_foreign_key "surface_items", "surfaces"
  add_foreign_key "surfaces", "surfaces", column: "previous_surface_id"
end
