require "flyd/redis_url"

sidekiq_redis_url = ENV.fetch("SIDEKIQ_REDIS_URL") do
  ENV.fetch("REDIS_URL") { Flyd::RedisUrl.sidekiq_default }
end

Sidekiq.configure_server do |config|
  config.redis = { url: sidekiq_redis_url }
end

Sidekiq.configure_client do |config|
  config.redis = { url: sidekiq_redis_url }
end
