namespace :flyd do
  namespace :release do
    desc "Mark the current commit as the start of the Release 1C dogfood window"
    task mark_1c: :environment do
      commit = ENV.fetch("RELEASE_COMMIT") { `git rev-parse HEAD`.strip }
      raise "Could not determine release commit" if commit.blank?

      marker = ReleaseMarker.find_or_initialize_by(release_key: "release_1c")
      if marker.persisted? && marker.metadata["commit"].to_s != commit
        raise "Release 1C is already marked for #{marker.metadata["commit"]}; use flyd:release:start_new_1c_trial explicitly"
      end
      unless marker.persisted?
        marker.available_at = Time.current
        marker.metadata = { "commit" => commit }
      end
      marker.save!
      puts "release_1c available at #{marker.available_at.iso8601} for #{marker.metadata.fetch("commit")}"
    end

    desc "Explicitly replace the Release 1C marker and start a new dogfood trial"
    task start_new_1c_trial: :environment do
      raise "Set CONFIRM_NEW_TRIAL=1 to start a new Release 1C trial" unless ENV["CONFIRM_NEW_TRIAL"] == "1"

      commit = ENV.fetch("RELEASE_COMMIT") { `git rev-parse HEAD`.strip }
      raise "Could not determine release commit" if commit.blank?

      marker = ReleaseMarker.find_or_initialize_by(release_key: "release_1c")
      marker.update!(available_at: Time.current, metadata: { "commit" => commit })
      puts "new release_1c trial available at #{marker.available_at.iso8601} for #{commit}"
    end
  end
end
