schedule_file = Rails.root.join("config", "sidekiq.yml")

if defined?(Sidekiq::Cron) && schedule_file.exist?
  Sidekiq.configure_server do
    schedule_data = YAML.safe_load(File.read(schedule_file), permitted_classes: [ Symbol ])
    schedule = schedule_data&.dig(:scheduler, :schedule)

    if schedule
      Sidekiq::Cron::Job.load_from_hash(schedule)
      Rails.logger.info "Loaded #{schedule.keys.length} sidekiq-cron jobs: #{schedule.keys.join(", ")}" 
    end
  end
end
