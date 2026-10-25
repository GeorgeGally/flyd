require "test_helper"

class AgentRuntime::LeaseTest < ActiveSupport::TestCase
  test "allows one owner and transfers only after expiry" do
    now = Time.zone.parse("2026-07-19 12:00:00")
    first = AgentRuntime::Lease.new(listener_key: "primary", owner: "one", duration: 10.seconds, now: -> { now })
    second = AgentRuntime::Lease.new(listener_key: "primary", owner: "two", duration: 10.seconds, now: -> { now })

    assert first.acquire
    assert_not second.acquire
    now += 11.seconds
    assert second.acquire
    assert_not first.renew
    assert second.renew
    assert second.release
  end
end
