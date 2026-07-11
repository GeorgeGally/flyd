require "open3"
require "timeout"

class RefreshIntelligenceStateJob < ApplicationJob
  queue_as :default

  TIMEOUT = 30.seconds

  retry_on Timeout::Error, wait: :exponentially_longer, attempts: 3

  def perform
    cli_dir = Rails.root.join("cli")
    return unless cli_dir.join("package.json").exist?

    Timeout.timeout(TIMEOUT) do
      stdout, stderr, status = Open3.capture3(
        "npm", "--prefix", cli_dir.to_s, "run", "export-state", "--silent"
      )

      unless status.success?
        raise "CLI intelligence state export failed: #{stderr.presence || stdout}"
      end
    end
  end
end
