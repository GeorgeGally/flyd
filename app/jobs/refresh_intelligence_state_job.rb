require "open3"
require "timeout"

class RefreshIntelligenceStateJob < ApplicationJob
  class ExportError < StandardError; end

  queue_as :default

  TIMEOUT = 30.seconds

  retry_on Timeout::Error, ExportError, wait: :exponentially_longer, attempts: 3

  def perform
    cli_dir = Rails.root.join("cli")
    raise ExportError, "CLI package not found" unless cli_dir.join("package.json").exist?

    Timeout.timeout(TIMEOUT) do
      stdout, stderr, status = Open3.capture3(
        "npm", "--prefix", cli_dir.to_s, "run", "export-state", "--silent"
      )

      unless status.success?
        raise ExportError, "CLI intelligence state export failed: #{stderr.presence || stdout}"
      end
    end
  ensure
    Rails.cache.delete(IntelligenceState::CliProvider::REFRESH_LOCK_KEY)
  end
end
