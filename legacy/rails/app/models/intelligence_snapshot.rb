require "digest"

class IntelligenceSnapshot < ApplicationRecord
  STATUSES = %w[fresh stale invalid unavailable].freeze
  USABLE_STATUSES = %w[fresh stale].freeze

  validates :provider, :schema_version, :state_digest, :received_at, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :state_digest, uniqueness: { scope: :provider }

  scope :newest_first, -> { order(received_at: :desc, created_at: :desc) }
  scope :usable, -> { where(status: USABLE_STATUSES) }

  class << self
    def latest_for(provider)
      usable.where(provider: provider).newest_first.first
    end

    def latest_record_for(provider)
      where(provider: provider).newest_first.first
    end

    def digest_for(payload)
      Digest::SHA256.hexdigest(JSON.generate(canonicalize(payload)))
    end

    def semantic_digest_for(payload)
      digest_for(without_volatile_generation_times(payload))
    end

    private

    def canonicalize(value)
      case value
      when Hash
        value.deep_stringify_keys.sort.to_h.transform_values { |nested| canonicalize(nested) }
      when Array
        value.map { |nested| canonicalize(nested) }
      else
        value
      end
    end

    def without_volatile_generation_times(value)
      case value
      when Hash
        value.each_with_object({}) do |(key, nested), result|
          next if key.to_s.in?(%w[generatedAt generated_at])

          result[key] = without_volatile_generation_times(nested)
        end
      when Array
        value.map { |nested| without_volatile_generation_times(nested) }
      else
        value
      end
    end
  end

  def fresh?
    status == "fresh" && fresh_until.present? && fresh_until > Time.current
  end
end
