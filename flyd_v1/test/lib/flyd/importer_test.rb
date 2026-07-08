require "test_helper"

class Flyd::ImporterTest < ActiveSupport::TestCase
  setup do
    @tmp_dir = Dir.mktmpdir("flyd-importer-test")
  end

  teardown do
    FileUtils.rm_rf(@tmp_dir) if @tmp_dir
  end

  test "imports capture files from raw directory" do
    write_capture_with_body("2026-07-07-10-00-00.md", "Body content",
      "source: cli", "project: flyd", "session_id: abc-123")

    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    result = importer.import!

    assert_equal 1, result[:imported]
    assert_equal 0, result[:skipped]

    imported = CaptureImport.last
    assert_equal "flyd", imported.project
    assert_equal "cli", imported.source_type
    assert_equal "abc-123", imported.session_id
    assert_equal "Body content", imported.body
  end

  test "deduplicates by content_hash" do
    write_capture("a.md", "project: one", "body A")
    write_capture("b.md", "project: one", "body A") # same content

    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    result = importer.import!

    assert_equal 1, result[:imported]
    assert_equal 1, result[:skipped]
  end

  test "handles empty raw directory" do
    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    result = importer.import!

    assert_equal 0, result[:imported]
    assert_equal 0, result[:skipped]
  end

  test "returns zero when directory does not exist" do
    importer = Flyd::Importer.new(raw_dir: "/nonexistent/path")
    result = importer.import!

    assert_equal 0, result[:imported]
    assert_equal 0, result[:skipped]
  end

  test "dry_run does not create records" do
    write_capture("test.md", "project: test", "body")

    importer = Flyd::Importer.new(raw_dir: @tmp_dir, dry_run: true)
    result = importer.import!

    assert_equal 0, result[:imported]
    assert_equal 0, CaptureImport.count
  end

  test "extracts timestamp from frontmatter" do
    write_capture("ts.md", "timestamp: 2026-07-04 14:30:00", "body with timestamp")

    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    importer.import!

    imported = CaptureImport.last
    assert_not_nil imported.timestamp
    assert_equal 2026, imported.timestamp.year
    assert_equal 7, imported.timestamp.month
  end

  test "re-running importer is idempotent" do
    write_capture_with_body("x.md", "unique body content", "project: flyd")

    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    r1 = importer.import!
    r2 = importer.import!

    assert_equal 1, r1[:imported]
    assert_equal 0, r2[:imported]
  end

  test "handles invalid timestamp gracefully" do
    write_capture("bad_ts.md", "timestamp: not-a-date")

    importer = Flyd::Importer.new(raw_dir: @tmp_dir)
    result = importer.import!

    assert_equal 1, result[:imported]
    assert_nil CaptureImport.last.timestamp
  end

  private

  def write_capture(filename, *frontmatter_lines)
    write_file(filename, frontmatter_lines, "")
  end

  def write_capture_with_body(filename, body, *frontmatter_lines)
    write_file(filename, frontmatter_lines, body)
  end

  def write_file(filename, frontmatter_lines, body)
    content = [ "---", *frontmatter_lines, "---", "", body ].join("\n")
    File.write(File.join(@tmp_dir, filename), content)
  end
end
