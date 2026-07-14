require "fileutils"
require "open3"
require "pathname"
require "tempfile"
require "tmpdir"

class BackupJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def perform
    backup_dir = Rails.configuration.flyd[:backup_directory]
    FileUtils.mkdir_p(backup_dir)

    timestamp = Time.current.strftime("%Y%m%d-%H%M%S")
    filename = File.join(backup_dir, "flyd-backup-#{timestamp}.tar.gz.gpg")
    passphrase = Rails.configuration.flyd[:backup_passphrase]
    return log_result(false, filename, "FLYD_BACKUP_PASSPHRASE not set") if passphrase.blank?

    db_config = ActiveRecord::Base.configurations.configs_for(env_name: Rails.env, name: "primary")
    return log_result(false, filename, "No primary database config") unless db_config

    Dir.mktmpdir("flyd-backup") do |working_dir|
      database_path = File.join(working_dir, "database.sql")
      database_error = dump_database(db_config, database_path)
      return log_result(false, filename, database_error) if database_error

      Tempfile.create([ "flyd-backup", ".tar.gz" ]) do |archive|
        archive.close
        archive_error = create_archive(archive.path, working_dir)
        return log_result(false, filename, archive_error) if archive_error

        encryption_error = encrypt_archive(archive.path, filename, passphrase)
        return log_result(false, filename, encryption_error) if encryption_error
      end
    end

    log_result(true, filename, nil)
  end

  private

  def dump_database(db_config, output_path)
    config = db_config.configuration_hash.symbolize_keys
    environment = {
      "PGPASSFILE" => "/dev/null",
      "PGDATABASE" => config[:database],
      "PGHOST" => config[:host],
      "PGPORT" => config[:port],
      "PGUSER" => config[:username],
      "PGPASSWORD" => config[:password]
    }.compact.transform_values(&:to_s)

    _stdout, stderr, status = Open3.capture3(environment, "pg_dump", "--file", output_path)
    return if status.success?

    FileUtils.rm_f(output_path)
    "pg_dump failed: #{stderr}"
  end

  def create_archive(archive_path, working_dir)
    command = [ "tar", "-czf", archive_path, "-C", working_dir, "database.sql" ]
    storage_root = Pathname.new(ENV.fetch("ACTIVE_STORAGE_ROOT", Rails.root.join("storage").to_s))
    if storage_root.directory?
      command.concat([ "-C", storage_root.dirname.to_s, storage_root.basename.to_s ])
    end

    _stdout, stderr, status = Open3.capture3(*command)
    status.success? ? nil : "archive failed: #{stderr}"
  end

  def encrypt_archive(archive_path, output_path, passphrase)
    Tempfile.create("gpg-passphrase") do |passphrase_file|
      passphrase_file.write(passphrase)
      passphrase_file.flush
      _stdout, stderr, status = Open3.capture3(
        { "GPG_TTY" => "/dev/null" },
        "gpg", "--batch", "--yes", "--passphrase-file", passphrase_file.path,
        "--output", output_path, "--symmetric", archive_path
      )
      return if status.success?

      FileUtils.rm_f(output_path)
      "gpg failed: #{stderr}"
    end
  end

  def log_result(success, filename, error)
    if success
      Rails.logger.info("Backup created: #{filename}")
    else
      Rails.logger.error("Backup failed: #{error}")
    end
  end
end
