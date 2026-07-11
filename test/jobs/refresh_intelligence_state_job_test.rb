require "test_helper"

class RefreshIntelligenceStateJobTest < ActiveJob::TestCase
  test "persists changed CLI state and queues surface composition" do
    job = RefreshIntelligenceStateJob.new
    json = payload(generated_at: Time.current).to_json

    job.stub(:run_exporter, json) do
      ComposeSurfaceJob.stub(:enqueue, true) do
        job.perform
      end
    end

    snapshot = IntelligenceSnapshot.latest_for("flyd-cli")
    assert snapshot.present?
    assert_equal "fresh", snapshot.status
    assert_equal "ship-flyd", snapshot.payload["goals"].first["slug"]
  end

  test "unchanged CLI state does not queue another composition" do
    provider = IntelligenceState::CliProvider.new
    state = payload(generated_at: Time.current)
    provider.persist!(state)
    job = RefreshIntelligenceStateJob.new
    calls = 0

    job.stub(:run_exporter, state.to_json) do
      ComposeSurfaceJob.stub(:enqueue, ->(**) { calls += 1 }) do
        job.perform
      end
    end

    assert_equal 0, calls
  end

  private

  def payload(generated_at:)
    {
      "version" => "1.0",
      "generatedAt" => generated_at.iso8601,
      "source" => "flyd-cli",
      "goals" => [{ "slug" => "ship-flyd" }],
      "tensions" => [],
      "signals" => [],
      "curiosity" => [],
      "nudges" => [],
      "reports" => [],
      "recentEvents" => []
    }
  end
end
