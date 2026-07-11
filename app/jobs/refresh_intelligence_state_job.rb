require "json"
require "open3"
require "timeout"

class RefreshIntelligenceStateJob < ApplicationJob
  class ExportError < StandardError; end

  queue_as :default

  TIMEOUT = 30.seconds

  retry_on Timeout::Error, ExportError, wait: :exponentially_longer, attempts: 3

  def perform
    stdout = run_exporter
    payload = JSON.parse(stdout)
    _snapshot, changed = IntelligenceState::CliProvider.new.persist!(payload)

    ComposeSurfaceJob.perform_later(reason: "provider_refresh") if changed
  rescue JSON::ParserError => error
    raise ExportError, "CLI intelligence state returned invalid JSON: #{error.message}"
  end

  private

  def run_exporter
    cli_dir = Rails.root.join("cli")
    compiled_exporter = cli_dir.join("dist", "export-state.js")

    command = if compiled_exporter.exist?
      ["node", compiled_exporter.to_s, "--stdout"]
    else
      ["npm", "--prefix", cli_dir.to_s, "run", "export-state", "--silent", "--", "--stdout"]
    end

    Timeout.timeout(TIMEOUT) do
      stdout, stderr, status = Open3.capture3(*command)
      raise ExportError, "CLI intelligence state export failed: #{stderr.presence || stdout}" unless status.success?

      stdout
    end
  rescue Errno::ENOENT => error
    raise ExportError, "CLI intelligence exporter unavailable: #{error.message}"
  end
end
