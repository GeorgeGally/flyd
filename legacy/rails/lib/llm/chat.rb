module Llm
  class Chat
    class Error < StandardError; end

    def initialize(model: nil)
      @model = model
    end

    def call(messages)
      provider.complete(messages)
    rescue => e
      Rails.logger.warn("Llm::Chat failed: #{e.message}")
      raise Error, e.message
    end

    def call!(messages)
      response = call(messages)
      raise Error, "Empty response from LLM" if response.blank?
      response
    end

    private

    def provider
      Llm::Provider.for(model)
    end

    def model
      @model.presence || extraction_model
    end

    def extraction_model
      Rails.configuration.flyd[:extraction_model].presence || Flyd::KeyLoader.default_model
    end
  end
end
