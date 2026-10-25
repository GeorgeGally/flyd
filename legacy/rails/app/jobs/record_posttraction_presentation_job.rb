class RecordPosttractionPresentationJob < ApplicationJob
  queue_as :default

  def perform(surface_id)
    surface = Surface.find_by(id: surface_id)
    return unless surface&.active?

    IntelligenceState::PosttractionPresentationRecorder.call(surface: surface)
  end
end
