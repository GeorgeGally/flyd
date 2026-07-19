require "test_helper"
require "erb"
require "yaml"

class ActionCableConfigurationTest < ActiveSupport::TestCase
  test "development cable broadcasts across web and worker processes" do
    config = YAML.safe_load(
      ERB.new(Rails.root.join("config/cable.yml").read).result,
      aliases: true
    )

    assert_equal "redis", config.dig("development", "adapter")
    assert_match %r{\Aredis://}, config.dig("development", "url")
  end
end
