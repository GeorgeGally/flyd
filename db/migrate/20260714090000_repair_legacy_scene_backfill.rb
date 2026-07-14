class RepairLegacySceneBackfill < ActiveRecord::Migration[8.0]
  def up
    execute <<~SQL
      UPDATE surface_items
      SET scene_id = scenes.id
      FROM scenes
      WHERE surface_items.scene_id IS NULL
        AND scenes.scene_key = surface_items.item_key
    SQL

    execute <<~SQL
      WITH latest_items AS (
        SELECT DISTINCT ON (scene_id)
          scene_id, kind, intent, renderer
        FROM surface_items
        WHERE scene_id IS NOT NULL
        ORDER BY scene_id, updated_at DESC, id DESC
      )
      UPDATE scenes
      SET kind = CASE
        WHEN latest_items.intent = 'build' OR latest_items.renderer = 'action_scene' THEN 'build'
        WHEN latest_items.intent = 'investigate' OR latest_items.renderer = 'investigation_scene' THEN 'investigation'
        WHEN latest_items.kind = 'question' THEN 'question'
        WHEN latest_items.kind = 'decision' OR latest_items.renderer = 'decision_scene' THEN 'decision'
        WHEN latest_items.kind = 'conversation' OR latest_items.renderer = 'conversation' THEN 'conversation'
        WHEN latest_items.kind = 'notification' OR latest_items.intent = 'monitor' THEN 'monitoring'
        ELSE 'work'
      END
      FROM latest_items
      WHERE scenes.id = latest_items.scene_id
    SQL

    backfill_reference(:intent, :source_refs, "intent")
    backfill_reference(:conversation, :source_refs, "conversation")
    backfill_reference(:project, :context_refs, "project", clear: :context_id)
    backfill_reference(:context, :context_refs, "context", clear: :project_id)

    execute <<~SQL
      UPDATE scenes
      SET conversation_id = intents.conversation_id
      FROM intents
      WHERE scenes.intent_id = intents.id
        AND scenes.conversation_id IS NULL
        AND intents.conversation_id IS NOT NULL
    SQL

    execute <<~SQL
      UPDATE scenes
      SET
        project_id = COALESCE(scenes.project_id, conversations.project_id),
        context_id = CASE
          WHEN COALESCE(scenes.project_id, conversations.project_id) IS NOT NULL THEN NULL
          ELSE COALESCE(scenes.context_id, conversations.context_id)
        END
      FROM conversations
      WHERE scenes.conversation_id = conversations.id
    SQL

    verify_backfill!
  end

  def down
    say "Legacy scene classification and ownership repair is irreversible; no data is changed."
  end

  private

  def backfill_reference(table, column, type, clear: nil)
    foreign_key = "#{table}_id"
    clear_assignment = clear ? ", #{clear} = NULL" : ""
    execute <<~SQL
      WITH latest_refs AS (
        SELECT DISTINCT ON (surface_items.scene_id)
          surface_items.scene_id,
          CASE
            WHEN reference.value->>'id' ~ '^[0-9]+$' THEN (reference.value->>'id')::bigint
          END AS referenced_id
        FROM surface_items
        CROSS JOIN LATERAL jsonb_array_elements(surface_items.#{column}) AS reference(value)
        JOIN #{table.to_s.pluralize}
          ON #{table.to_s.pluralize}.id = CASE
            WHEN reference.value->>'id' ~ '^[0-9]+$' THEN (reference.value->>'id')::bigint
          END
        WHERE surface_items.scene_id IS NOT NULL
          AND reference.value->>'type' = #{connection.quote(type)}
          AND reference.value->>'id' ~ '^[0-9]+$'
        ORDER BY surface_items.scene_id, surface_items.updated_at DESC, surface_items.id DESC
      )
      UPDATE scenes
      SET #{foreign_key} = latest_refs.referenced_id#{clear_assignment}
      FROM latest_refs
      WHERE scenes.id = latest_refs.scene_id
        AND scenes.#{foreign_key} IS NULL
    SQL
  end

  def verify_backfill!
    kind_counts = connection.select_rows("SELECT kind, count(*) FROM scenes GROUP BY kind ORDER BY kind")
    ownerless_count = connection.select_value(<<~SQL).to_i
      SELECT count(*) FROM scenes
      WHERE project_id IS NULL AND context_id IS NULL AND conversation_id IS NULL
    SQL
    orphan_count = connection.select_value("SELECT count(*) FROM surface_items WHERE scene_id IS NULL").to_i

    say "Scene kinds: #{kind_counts.to_h.inspect}"
    say "Ownerless scenes: #{ownerless_count}"
    say "Surface items without scenes: #{orphan_count}"
    raise ActiveRecord::MigrationError, "#{orphan_count} surface items remain without scenes" if orphan_count.positive?
  end
end
