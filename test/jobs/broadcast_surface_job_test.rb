require "test_helper"

class BroadcastSurfaceJobTest < ActiveJob::TestCase
  test "retries transient broadcast failures" do
    job = BroadcastSurfaceJob.new(1)
    job.define_singleton_method(:perform) { |_surface_id| raise "temporary failure" }

    assert_enqueued_jobs 1 do
      job.perform_now
    end
  end

  test "renders the surface plane outside a controller request" do
    surface = Surface.fallback!

    assert_nothing_raised do
      BroadcastSurfaceJob.new.perform(surface.id)
    end
  end

  test "morphs the persisted surface plane by semantic identity" do
    surface = Surface.fallback!
    calls = []

    Turbo::StreamsChannel.stub(:broadcast_replace_to, ->(*args, **kwargs) { calls << [ args, kwargs ] }) do
      BroadcastSurfaceJob.perform_now(surface.id)
    end

    assert_equal 1, calls.length
    assert_equal "flyd_surface", calls.first.first.first
    assert_equal "surface_plane", calls.first.last[:target]
    assert_equal :morph, calls.first.last[:method]
    assert_equal surface, calls.first.last[:locals][:surface]
  end
end
