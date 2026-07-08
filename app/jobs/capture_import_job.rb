class CaptureImportJob < ApplicationJob
  queue_as :default

  def perform
    importer = Flyd::Importer.new
    result = importer.import!
    Rails.logger.info("CaptureImportJob: imported #{result[:imported]}, skipped #{result[:skipped]}")
    result
  end
end
