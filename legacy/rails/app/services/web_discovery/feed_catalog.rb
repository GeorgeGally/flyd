module WebDiscovery
  class FeedCatalog
    CONFIG_PATH = Rails.root.join("config/news_feeds.yml")

    class << self
      def sources
        publishers + subreddits
      end

      private

      def configuration
        YAML.safe_load_file(CONFIG_PATH).to_h.deep_symbolize_keys
      end

      def publishers
        Array(configuration[:publishers]).map do |source|
          source.to_h.symbolize_keys.merge(kind: "publisher")
        end
      end

      def subreddits
        configuration.fetch(:reddit, {}).flat_map do |category, names|
          Array(names).map do |name|
            {
              name: "r/#{name}",
              url: "https://www.reddit.com/r/#{name}/.rss",
              kind: "reddit",
              category: category.to_s
            }
          end
        end
      end
    end
  end
end
