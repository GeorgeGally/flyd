require "openai"
require "net/http"
require "json"

module Llm
  class Provider
    def self.for(model)
      if Flyd::KeyLoader.is_openai_model?(model)
        OpenaiProvider.new(model)
      else
        AnthropicProvider.new(model)
      end
    end

    attr_reader :model

    def initialize(model)
      @model = model
    end

    def stream(messages, &block)
      raise NotImplementedError
    end

    def complete(messages)
      stream(messages) { |token| }
    end

    def count_tokens(text)
      (text.length / 4.0).ceil
    end
  end

  class OpenaiProvider < Provider
    def stream(messages, &block)
      client = OpenAI::Client.new(access_token: api_key, log_errors: false)
      full = ""

      client.chat(
        parameters: {
          model: model,
          messages: messages,
          temperature: 0.2,
          max_tokens: 4096,
          stream: ->(chunk, _bytesize) {
            token = chunk.dig("choices", 0, "delta", "content")
            if token
              full += token
              block.call(token)
            end
          }
        }
      )

      full
    end

    private

    def api_key
      Flyd::KeyLoader.get("OPENAI_API_KEY")
    end
  end

  class AnthropicProvider < Provider
    ANTHROPIC_API = "https://api.anthropic.com/v1/messages"

    def stream(messages, &block)
      full = ""
      body = {
        model: model,
        max_tokens: 4096,
        temperature: 0.2,
        system: extract_system(messages),
        messages: extract_messages(messages),
        stream: true
      }

      uri = URI(ANTHROPIC_API)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 120

      request = Net::HTTP::Post.new(uri)
      request["x-api-key"] = api_key
      request["anthropic-version"] = "2023-06-01"
      request["Content-Type"] = "application/json"
      request.body = body.to_json

      http.request(request) do |response|
        response.read_body do |chunk|
          chunk.each_line do |line|
            next unless line.start_with?("data: ")
            data = line[6..]
            next if data.strip == "[DONE]"

            parsed = JSON.parse(data) rescue next
            type = parsed["type"]

            if type == "content_block_delta"
              delta = parsed.dig("delta", "text")
              if delta
                full += delta
                block.call(delta)
              end
            end
          end
        end
      end

      full
    end

    private

    def api_key
      Flyd::KeyLoader.get("ANTHROPIC_API_KEY")
    end

    def extract_system(messages)
      sys = messages.find { |m| m[:role] == "system" || m["role"] == "system" }
      sys ? (sys[:content] || sys["content"]) : nil
    end

    def extract_messages(messages)
      messages.reject { |m| (m[:role] || m["role"]) == "system" }
    end
  end
end
