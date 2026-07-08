require "digest"

class Flyd::Importer
  def initialize(raw_dir: Rails.configuration.flyd[:raw_directory], dry_run: false)
    @raw_dir = raw_dir
    @dry_run = dry_run
    @imported = 0
    @skipped = 0
  end

  def import!
    @imported = 0
    @skipped = 0
    return { imported: 0, skipped: 0 } unless Dir.exist?(@raw_dir)

    markdown_files.each do |file|
      process_file(file)
    end

    { imported: @imported, skipped: @skipped }
  end

  private

  def markdown_files
    Dir.glob(File.join(@raw_dir, "*.md")).sort
  end

  def process_file(file)
    content = File.read(file)
    hash = Digest::SHA256.hexdigest(content)

    if CaptureImport.exists?(content_hash: hash)
      @skipped += 1
      return
    end

    parsed = Flyd::FrontmatterParser.parse(content)
    return if @dry_run

    CaptureImport.create!(
      source_file: File.basename(file),
      content_hash: hash,
      project: parsed.metadata["project"]&.to_s,
      timestamp: parse_timestamp(parsed.metadata["timestamp"]),
      session_id: parsed.metadata["session_id"]&.to_s,
      source_type: parsed.metadata["source"]&.to_s,
      body: parsed.body,
      imported_at: Time.current
    )
    @imported += 1
  rescue StandardError => e
    Rails.logger.warn("Failed to import #{file}: #{e.message}")
    @skipped += 1
  end

  def parse_timestamp(val)
    return nil unless val
    Time.parse(val.to_s)
  rescue ArgumentError
    nil
  end
end
