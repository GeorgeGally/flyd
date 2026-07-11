require "digest"

class IntelligenceSnapshot < ApplicationRecord
  STATUSES = %w[fresh stale invalid unavailable].freeze

  validates :provider, :schema_version, :state_digest, :received_at, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :state_digest, uniqueness: { scope: :provider }

  scope :newest_first, -> { order(generated_at: :desc, created_at: :desc) }

  class << self
    def latest_for(provider)
      where(provider: provider).newest_first.first
    end

    def digest_for(payload)
      Digest::SHA256.hexdigest(JSON.generate(payload.deep_stringify_keys.sort.to_h))
    end
  end

  def fresh?
    status == "fresh" && fresh_until.present? && fresh_until > Time.current
  end
end
