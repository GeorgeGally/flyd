class Behaviour < ApplicationRecord
  include Decayable

  belongs_to :project, optional: true

  validates :name, presence: true
  validates :trigger_phrase, presence: true

  scope :matching, ->(text) {
    where(arel_table[:trigger_phrase].lower.matches_any(
      text.downcase.split.map { |w| "%#{w}%" }
    ))
  }
  scope :by_success_rate, -> {
    order(Arel.sql("CASE WHEN (success_count + failure_count) > 0 THEN success_count::float / (success_count + failure_count) ELSE 0 END DESC"))
  }

  def success_rate
    total = success_count + failure_count
    return 0 if total == 0
    success_count.to_f / total
  end

  def matching_trigger?(text)
    trigger_phrase.split.map { |w| text.downcase.include?(w.downcase) }.all?
  end

  def record_success!
    transaction do
      increment!(:success_count)
      reinforce!
    end
  end

  def record_failure!
    increment!(:failure_count)
  end

  def decay_type
    :behaviour
  end
end
