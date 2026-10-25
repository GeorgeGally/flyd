require "test_helper"

class RecordPosttractionPresentationJobTest < ActiveJob::TestCase
  test "records evidence only while the surface remains active" do
    surface = Surface.fallback!
    calls = []

    IntelligenceState::PosttractionPresentationRecorder.stub(:call, ->(surface:) { calls << surface.id }) do
      RecordPosttractionPresentationJob.perform_now(surface.id)
      surface.update!(status: "superseded")
      RecordPosttractionPresentationJob.perform_now(surface.id)
    end

    assert_equal [ surface.id ], calls
  end
end
