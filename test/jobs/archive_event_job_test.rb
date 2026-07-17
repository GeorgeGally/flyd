require "test_helper"

class ArchiveEventJobTest < ActiveJob::TestCase
  test "writes the event and refreshes shared intelligence" do
    writes = []
    refreshes = 0
    writer = Object.new
    writer.define_singleton_method(:write!) { |**attributes| writes << attributes }

    Flyd::ArchiveEventWriter.stub(:new, writer) do
      RefreshIntelligenceStateJob.stub(:enqueue, -> { refreshes += 1 }) do
        ArchiveEventJob.perform_now(
          "event_key" => "intent:1:accepted",
          "body" => "Build the interface",
          "event_type" => "intent"
        )
      end
    end

    assert_equal "intent:1:accepted", writes.first[:event_key]
    assert_equal "Build the interface", writes.first[:body]
    assert_equal 1, refreshes
  end
end
