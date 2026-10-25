class ConstrainReleaseAcceptanceObservationKinds < ActiveRecord::Migration[8.0]
  def change
    add_check_constraint :release_acceptance_observations,
      "kind IN ('memory_safety', 'recommendation_rationale', 'automated_acceptance')",
      name: "release_acceptance_observations_kind_check"
  end
end
