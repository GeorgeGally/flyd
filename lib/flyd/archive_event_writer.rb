require "digest"
require "fileutils"
require "securerandom"

class Flyd::ArchiveEventWriter
  def initialize(raw_dir: Rails.configuration.flyd[:raw_directory])
    @raw_dir = raw_dir.to_s
  end

  def write!(event_key:, body:, event_type: "observation", outcome: nil, signal: nil, project: nil, record_type: nil, record_id: nil, timestamp: Time.current)
    body = body.to_s.strip
    raise ArgumentError, "Archive event requires a stable key" if event_key.blank?
    raise ArgumentError, "Archive event requires content" if body.blank?

    timestamp = timestamp.to_time.utc
    digest = Digest::SHA256.hexdigest(event_key.to_s)[0, 12]
    path = File.join(@raw_dir, "#{timestamp.strftime("%Y-%m-%d-%H-%M-%S")}-rails-#{digest}.md")
    return path if File.exist?(path)

    FileUtils.mkdir_p(@raw_dir)
    temporary_path = File.join(@raw_dir, ".#{File.basename(path)}.#{SecureRandom.hex(6)}.tmp")
    File.write(temporary_path, serialize(
      {
        source: "rails",
        project: project,
        project_path: Rails.root.to_s,
        timestamp: timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        event_type: event_type,
        outcome: outcome,
        signal: signal,
        rails_record_type: record_type,
        rails_record_id: record_id,
        event_key: event_key
      }.compact,
      body
    ))
    File.rename(temporary_path, path)
    path
  ensure
    File.delete(temporary_path) if defined?(temporary_path) && temporary_path && File.exist?(temporary_path)
  end

  private

  def serialize(metadata, body)
    lines = [ "---" ]
    metadata.each do |key, value|
      lines << "#{key}: #{value.to_s.gsub(/[\r\n]+/, " ").strip}"
    end
    lines.concat([ "---", "", body ])
    lines.join("\n")
  end
end
