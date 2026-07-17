require "test_helper"

class IntelligenceState::CliBridgeTest < ActiveSupport::TestCase
  Success = Data.define(:success?)

  test "retrieves structured evidence through the compiled CLI bridge" do
    calls = []
    runner = lambda do |*command, chdir:|
      calls << [ command, chdir ]
      [ JSON.generate(version: "1.0", source: "flyd-cli", query: "last work", matches: []), "", Success.new(true) ]
    end

    payload = IntelligenceState::CliBridge.new(command_runner: runner).retrieve("last work")

    assert_equal "last work", payload.fetch("query")
    assert_equal [ "node", Rails.root.join("cli/dist/bridge.js").to_s, "retrieve", "--query", "last work" ], calls.first.first
    assert_equal Rails.root.join("cli").to_s, calls.first.last
  end

  test "raises a useful error when the CLI bridge fails" do
    runner = ->(*) { [ "", "archive unavailable", Success.new(false) ] }

    error = assert_raises(IntelligenceState::CliBridge::Error) do
      IntelligenceState::CliBridge.new(command_runner: runner).retrieve("last work")
    end

    assert_match(/archive unavailable/, error.message)
  end
end
