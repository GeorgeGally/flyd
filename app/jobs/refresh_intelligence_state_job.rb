require "json"
require "open3"
require "timeout"

class RefreshIntelligenceStateJob < ApplicationJob
  class ExportError < StandardError; end

  queue_as :default

  TIMEOUT = 30.seconds
  LOCK_KEY = "intelligence_state:refresh_enqueued"
  LOCK_TTL = 5.minutes

  retry_on Timeout::Error, ExportError, wait: :exponentially_longer, attempts: 3 do |_job, error|
    IntelligenceState::CliProvider.new.record_failure!(error)
    Rails.cache.delete(LOCK_KEY)
  end

  def self.enqueue(force: false)
    return false unless force || Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform
    stdout = run_exporter
    payload = JSON.parse(stdout)
    _snapshot, changed = IntelligenceState::CliProvider.new.persist!(payload)
    surface = Surface.current

    if changed || surface.nil? || surface.stale? || surface.metadata["fallback"]
      ComposeSurfaceJob.enqueue(reason: changed ? "provider_refresh" : "surface_refresh")
    end

    Rails.cache.delete(LOCK_KEY)
  rescue JSON::ParserError => error
    raise ExportError, "CLI intelligence state returned invalid JSON: #{error.message}"
  rescue Timeout::Error, ExportError
    raise
  rescue StandardError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def run_exporter
    cli_dir = Rails.root.join("cli")
    compiled_exporter = cli_dir.join("dist", "export-state.js")

    command = if compiled_exporter.exist?
      ["node", compiled_exporter.to_s, "--stdout"]
    elsif Rails.env.production?
      raise ExportError, "Compiled CLI exporter missing at #{compiled_exporter}"
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
