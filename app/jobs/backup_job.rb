require "open3"
require "tempfile"

class BackupJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform
    backup_dir = Rails.configuration.flyd[:backup_directory]
    FileUtils.mkdir_p(backup_dir)

    timestamp = Time.current.strftime("%Y%m%d-%H%M%S")
    filename = File.join(backup_dir, "flyd-backup-#{timestamp}.sql.gz.enc")
    passphrase = Rails.configuration.flyd[:backup_passphrase]

    if passphrase.blank?
      return log_result(false, filename, "FLYD_BACKUP_PASSPHRASE not set")
    end

    db_config = ActiveRecord::Base.configurations.configs_for(env_name: Rails.env, name: "primary")
    return log_result(false, filename, "No primary database config") unless db_config

    stdout, stderr, status = Open3.capture3(
      { "PGPASSFILE" => "/dev/null" },
      "pg_dump", db_config.database
    )

    unless status.success?
      return log_result(false, filename, "pg_dump failed: #{stderr}")
    end

    stdout2 = stderr2 = status2 = nil
    Tempfile.create("gpg-passphrase") do |pf|
      pf.write(passphrase)
      pf.flush
      stdout2, stderr2, status2 = Open3.capture3(
        { "GPG_TTY" => "/dev/null" },
        "gpg", "--batch", "--yes", "--passphrase-file", pf.path, "-c",
        stdin_data: stdout
      )
    end

    if status2.success?
      File.write(filename, stdout2)
      log_result(true, filename, nil)
    else
      log_result(false, filename, "gpg failed: #{stderr2}")
    end
  end

  private

  def log_result(success, filename, error)
    if success
      Rails.logger.info("Backup created: #{filename}")
    else
      Rails.logger.error("Backup failed: #{error}")
    end
  end
end
