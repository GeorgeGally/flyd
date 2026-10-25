module Flyd
  class RedisUrl
    def self.sidekiq_default(env = Rails.env)
      env.to_s == "development" ? "redis://localhost:6379/1" : "redis://localhost:6379/0"
    end
  end
end
