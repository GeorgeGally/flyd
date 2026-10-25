module AgentRuntime
  class Lease
    DEFAULT_DURATION = 15.seconds

    def initialize(listener_key:, owner:, duration: DEFAULT_DURATION, now: -> { Time.current })
      @listener_key = listener_key
      @owner = owner
      @duration = duration
      @now = now
    end

    def acquire
      ensure_state
      RuntimeDeliveryState.transaction do
        state = locked_state
        return false if state.lease_active?(at: @now.call) && state.lease_owner != @owner

        state.update!(lease_owner: @owner, lease_expires_at: @now.call + @duration, last_error: nil)
        true
      end
    end

    def renew
      RuntimeDeliveryState.transaction do
        state = RuntimeDeliveryState.lock.find_by(listener_key: @listener_key)
        return false unless state&.lease_owner == @owner

        state.update!(lease_expires_at: @now.call + @duration)
        true
      end
    end

    def release
      RuntimeDeliveryState.transaction do
        state = RuntimeDeliveryState.lock.find_by(listener_key: @listener_key)
        return false unless state&.lease_owner == @owner

        state.update!(lease_owner: nil, lease_expires_at: nil)
        true
      end
    end

    private

    def locked_state
      RuntimeDeliveryState.lock.find_by!(listener_key: @listener_key)
    end

    def ensure_state
      RuntimeDeliveryState.find_or_create_by!(listener_key: @listener_key)
    end
  end
end
