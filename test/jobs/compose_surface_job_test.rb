require "test_helper"

class ComposeSurfaceJobTest < ActiveJob::TestCase
  Item = Data.define(:id, :kind, :intent, :renderer, :depth, :state, :title, :summary, :context_refs, :source_refs, :actions)
  Plan = Data.define(:generated_at, :understanding, :current_intention, :focus_item_id, :items)

  test "persists, activates, and queues broadcast for a composed surface" do
    previous = Surface.fallback!
    plan = build_plan

    Flyd::Intelligence.stub(:compose_surface, plan) do
      assert_enqueued_with(job: BroadcastSurfaceJob) do
        ComposeSurfaceJob.perform_now(reason: "provider_refresh")
      end
    end

    active = Surface.current
    assert_not_equal previous, active
    assert_equal "superseded", previous.reload.status
    assert_equal "Prepared next scene", active.surface_items.first.title
    assert_equal "provider_refresh", active.metadata["composition_reason"]
  end

  test "coalesces a later trigger instead of dropping it" do
    cache = ActiveSupport::Cache::MemoryStore.new

    Rails.stub(:cache, cache) do
      assert ComposeSurfaceJob.enqueue(reason: "new_intent", active_conversation_id: 1)
      assert_not ComposeSurfaceJob.enqueue(reason: "assistant_response", active_conversation_id: 1)

      pending = cache.read(ComposeSurfaceJob::PENDING_KEY)
      assert_equal "assistant_response", pending["reason"]

      assert_enqueued_with(job: ComposeSurfaceJob) do
        ComposeSurfaceJob.finish_and_enqueue_pending
      end
    end
  end

  test "failed composition preserves the current active surface" do
    current = Surface.fallback!
    job = ComposeSurfaceJob.new

    Flyd::Intelligence.stub(:compose_surface, ->(*) { raise Llm::Chat::Error, "offline" }) do
      assert_raises(Llm::Chat::Error) do
        job.perform(reason: "surface_stale")
      end
    end

    assert_equal current, Surface.current
    assert current.reload.active?
  end

  test "non-retryable failures are persisted without replacing the active surface" do
    current = Surface.fallback!
    job = ComposeSurfaceJob.new

    Flyd::Intelligence.stub(:compose_surface, ->(*) { raise RuntimeError, "unexpected" }) do
      assert_raises(RuntimeError) do
        job.perform(reason: "manual_refresh")
      end
    end

    failure = Surface.where(status: "invalid").newest_first.first
    assert_equal "unexpected", failure.metadata["invalid_reason"]
    assert_equal current, Surface.current
  end

  private

  def build_plan
    Plan.new(
      generated_at: Time.current,
      understanding: "A changed state needs attention.",
      current_intention: "Present the next scene.",
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
          actions: []
        )
      ]
    )
  end
end
