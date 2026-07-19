class RuntimeDeliveryState < ApplicationRecord
  validates :listener_key, presence: true, uniqueness: true
  validates :last_event_id, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :delivery_latency_ms, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true

  def lease_active?(at: Time.current)
    lease_owner.present? && lease_expires_at.present? && lease_expires_at > at
  end

  def covers?(task)
    latest_event_id = task.runtime_events.maximum(:id).to_i
    lease_active? && last_event_id >= latest_event_id && last_error.blank?
  end
end
