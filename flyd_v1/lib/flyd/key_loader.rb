require "json"
require "fileutils"

module Flyd
  class KeyLoader
    CONFIG_PATH = File.join(Dir.home, ".flyd", "config.json")

    KEYS = %w[OPENAI_API_KEY ANTHROPIC_API_KEY FLYD_MODEL].freeze

    def self.get(key)
      ENV[key] || load_config[key]
    end

    def self.default_model
      get("FLYD_MODEL") || "gpt-4o-mini"
    end

    def self.has_api_key?(model = nil)
      m = model || default_model
      if is_openai_model?(m)
        !!get("OPENAI_API_KEY")
      else
        !!get("ANTHROPIC_API_KEY")
      end
    end

    def self.is_openai_model?(model)
      model.match?(/\A(gpt-|o1-|o3-|o4-)/)
    end

    def self.all_keys_missing?
      KEYS.none? { |k| get(k) }
    end

    def self.save!(updates)
      FileUtils.mkdir_p(File.dirname(CONFIG_PATH))
      existing = load_config
      File.write(CONFIG_PATH, JSON.pretty_generate(existing.merge(updates)))
    end

    def self.config_present?
      File.exist?(CONFIG_PATH)
    end

    private

    def self.load_config
      return {} unless File.exist?(CONFIG_PATH)

      JSON.parse(File.read(CONFIG_PATH))
    rescue JSON::ParserError
      {}
    end
  end
end
