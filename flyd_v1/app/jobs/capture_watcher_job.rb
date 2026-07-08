class CaptureWatcherJob < ApplicationJob
  require "digest"

  queue_as :default

  def perform
    importer = Flyd::Importer.new
    result = importer.import!
    Rails.logger.info("CaptureWatcherJob: imported #{result[:imported]}, skipped #{result[:skipped]}")
  end
end
