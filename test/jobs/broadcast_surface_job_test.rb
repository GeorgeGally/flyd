require "test_helper"

class BroadcastSurfaceJobTest < ActiveJob::TestCase
  test "broadcasts the persisted surface plane" do
    surface = Surface.fallback!
    calls = []

    Turbo::StreamsChannel.stub(:broadcast_replace_to, ->(*args, **kwargs) { calls << [args, kwargs] }) do
      BroadcastSurfaceJob.perform_now(surface.id)
    end

    assert_equal 1, calls.length
    assert_equal "flyd_surface", calls.first.first.first
    assert_equal "surface_plane", calls.first.last[:target]
    assert_equal surface, calls.first.last[:locals][:surface]
  end
end
