require "test_helper"

class AgentRuntime::BridgeTest < ActiveSupport::TestCase
  Success = Data.define(:success?)

  test "sends one JSON request over stdin and returns the authoritative result" do
    calls = []
    runner = lambda do |*command, stdin_data:, chdir:|
      calls << { command:, input: JSON.parse(stdin_data), chdir: }
      [
        JSON.generate(
          schemaVersion: 1,
          ok: true,
          result: { action: "health", data: { healthy: true } }
        ),
        "",
        Success.new(true)
      ]
    end
    bridge_path = Rails.root.join("cli/src/runtime-bridge.ts")

    result = AgentRuntime::Bridge.new(command_runner: runner, bridge_path:).call(
      schemaVersion: 1,
      action: "health",
      actorSurface: "rails"
    )

    assert_equal true, result.dig("data", "healthy")
    assert_equal [ "node", bridge_path.to_s ], calls.first.fetch(:command)
    assert_equal "health", calls.first.dig(:input, "action")
    assert_equal Rails.root.join("cli").to_s, calls.first.fetch(:chdir)
  end

  test "preserves a structured runtime failure" do
    runner = lambda do |*, **|
      [
        JSON.generate(ok: false, error: { code: "revision_conflict", message: "Task revision changed" }),
        "",
        Success.new(false)
      ]
    end

    error = assert_raises(AgentRuntime::Bridge::Error) do
      AgentRuntime::Bridge.new(command_runner: runner).call(
        schemaVersion: 1,
        action: "health",
        actorSurface: "rails"
      )
    end

    assert_equal "revision_conflict", error.code
    assert_match(/revision changed/i, error.message)
  end

  test "terminates a timed out runtime process group" do
    script = Tempfile.new([ "slow-runtime", ".js" ])
    script.write("setTimeout(() => process.stdout.write('{}'), 30_000)")
    script.close

    error = assert_raises(AgentRuntime::Bridge::Error) do
      AgentRuntime::Bridge.new(bridge_path: script.path, timeout: 0.05.seconds).call(
        schemaVersion: 1,
        action: "health",
        actorSurface: "rails"
      )
    end

    assert_match(/unavailable/i, error.message)
  ensure
    script&.unlink
  end
end
