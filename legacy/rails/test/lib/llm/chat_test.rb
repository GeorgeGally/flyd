require "test_helper"

module Llm
  class ChatTest < ActiveSupport::TestCase
    test "call returns a string from the LLM" do
      skip "Requires API key" unless Flyd::KeyLoader.has_api_key?("gpt-4o-mini")

      chat = Llm::Chat.new(model: "gpt-4o-mini")
      response = chat.call([
        { role: "system", content: "Respond with exactly one word." },
        { role: "user", content: "Say hello" }
      ])
      assert response.is_a?(String)
      assert response.length > 0
    end

    test "call wraps provider errors" do
      chat = Llm::Chat.new(model: "gpt-4o-mini")
      mock_provider = Llm::Provider.for("gpt-4o-mini")
      mock_provider.define_singleton_method(:complete) { |*| raise "boom" }
      chat.define_singleton_method(:provider) { mock_provider }

      error = assert_raises(Llm::Chat::Error) do
        chat.call([{ role: "user", content: "hi" }])
      end
      assert_includes error.message, "boom"
    end

    test "call! raises Error when response is blank" do
      chat = Llm::Chat.new(model: "gpt-4o-mini")
      mock_provider = Llm::Provider.for("gpt-4o-mini")
      mock_provider.define_singleton_method(:complete) { |*| "" }
      chat.define_singleton_method(:provider) { mock_provider }

      error = assert_raises(Llm::Chat::Error) do
        chat.call!([{ role: "user", content: "hi" }])
      end
      assert_includes error.message, "Empty response"
    end

    test "has a Llm::Chat::Error exception class" do
      assert Llm::Chat::Error.ancestors.include?(StandardError)
    end
  end
end
