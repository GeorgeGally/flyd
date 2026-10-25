require "test_helper"
require "flyd/redis_url"

class SidekiqConfigurationTest < ActiveSupport::TestCase
  test "development sidekiq jobs use the same redis database as cable broadcasts" do
    assert_equal "redis://localhost:6379/1", Flyd::RedisUrl.sidekiq_default("development")
  end

  test "production sidekiq jobs keep the production redis default" do
    assert_equal "redis://localhost:6379/0", Flyd::RedisUrl.sidekiq_default("production")
  end
end
