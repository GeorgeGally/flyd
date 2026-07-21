class RuntimeDeliveryReceipt < ApplicationRecord
  belongs_to :runtime_event

  validates :client_id, presence: true
  validates :acknowledged_at, presence: true
  validates :delivery_latency_ms, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :task_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :binding_digest, presence: true
end
