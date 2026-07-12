require "test_helper"

class ComposeSurfaceJobTest < ActiveJob::TestCase
  Item = Data.define(:id, :kind, :intent, :renderer, :depth, :state, :title, :summary, :context_refs, :source_refs, :actions, :relationships, :metadata)
  Plan = Data.define(:generated_at, :understanding, :current_intention, :surface_mode, :focus_item_id, :items, :relationships)

  test "persists, activates, logs, and queues broadcast for a composed surface" do
    previous = Surface.fallback!
    intelligence = fake_intelligence(build_plan)

    Flyd::Intelligence.stub(:new, intelligence) do
      assert_enqueued_with(job: BroadcastSurfaceJob) do
        ComposeSurfaceJob.perform_now(reason: "provider_refresh")
      end
    end

    active = Surface.current
    assert_not_equal previous, active
    assert_equal "superseded", previous.reload.status
    assert_equal "Prepared next scene", active.surface_items.first.title
    assert_equal "provider_refresh", active.metadata["composition_reason"]
    assert_equal "compiled-state", active.source_state_digest
    assert_equal 42, active.metadata.dig("provider_snapshots", 0, "snapshot_id")
    assert_equal "succeeded", SurfaceCompositionLog.last.status
  end

  test "coalesces a later trigger instead of dropping it" do
    cache = ActiveSupport::Cache::MemoryStore.new

    Rails.stub(:cache, cache) do
      assert ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: 1)
      assert_not ComposeSurfaceJob.enqueue(reason: "assistant_response", active_conversation_id: 1)

      pending = cache.read(ComposeSurfaceJob::PENDING_KEY)
      assert_equal "assistant_response", pending["reason"]

      clear_enqueued_jobs
      assert_enqueued_with(job: ComposeSurfaceJob) do
        ComposeSurfaceJob.finish_and_enqueue_pending
      end
    end
  end

  test "broadcast enqueue failure does not turn successful composition into failure" do
    intelligence = fake_intelligence(build_plan)

    Flyd::Intelligence.stub(:new, intelligence) do
      BroadcastSurfaceJob.stub(:perform_later, ->(*) { raise ActiveJob::EnqueueError, "queue unavailable" }) do
        ComposeSurfaceJob.perform_now(reason: "provider_refresh")
      end
    end

    log = SurfaceCompositionLog.order(:created_at).last
    assert_equal "succeeded", log.status
    assert_equal "queue unavailable", log.metadata["broadcast_enqueue_error"]
    assert Surface.current.active?
  end

  test "failed composition preserves the current active surface" do
    current = Surface.fallback!
    intelligence = Object.new
    intelligence.define_singleton_method(:compose_surface) { raise Llm::Chat::Error, "offline" }

    Flyd::Intelligence.stub(:new, intelligence) do
      assert_raises(Llm::Chat::Error) do
        ComposeSurfaceJob.new.perform(reason: "surface_stale")
      end
    end

    assert_equal current, Surface.current
    assert current.reload.active?
  end

  test "non-retryable failures are logged without replacing the active surface" do
    current = Surface.fallback!
    intelligence = Object.new
    intelligence.define_singleton_method(:compose_surface) { raise RuntimeError, "unexpected" }

    Flyd::Intelligence.stub(:new, intelligence) do
      assert_raises(RuntimeError) do
        ComposeSurfaceJob.new.perform(reason: "manual_refresh")
      end
    end

    failure = SurfaceCompositionLog.order(:created_at).last
    assert_equal "unexpected", failure.validation_errors.first
    assert_equal current, Surface.current
  end

  private

  def fake_intelligence(plan)
    Object.new.tap do |intelligence|
      intelligence.define_singleton_method(:compose_surface) { plan }
      intelligence.define_singleton_method(:diagnostics) do
        {
          state_digest: "compiled-state",
          provider_snapshots: [{ "source" => "flyd-cli", "snapshot_id" => 42, "state_digest" => "provider-state", "fresh" => true }],
          input_characters: 100,
          output_characters: 80,
          latency_ms: 12,
          dropped: []
        }
      end
    end
  end

  def build_plan
    Plan.new(
      generated_at: Time.current,
      understanding: "A changed state needs attention.",
      current_intention: "Present the next scene.",
      surface_mode: "interaction",
      focus_item_id: "next-scene",
      items: [
        Item.new(
          id: "next-scene",
          kind: "scene",
          intent: "inform",
          renderer: "hero_scene",
          depth: "foreground",
          state: "presented",
          title: "Prepared next scene",
          summary: "Flyd prepared this asynchronously.",
          context_refs: [],
          source_refs: [],
          actions: [],
          relationships: [],
          metadata: {}
        )
      ],
      relationships: []
    )
  end
end
