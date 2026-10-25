namespace :flyd do
  desc "Listen for committed Flyd runtime events and update the active Rails surface"
  task runtime_listener: :environment do
    AgentRuntime::EventListener.new.run
  end
end
