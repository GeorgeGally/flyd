class BindTaskRecommendationsToSurfaces < ActiveRecord::Migration[8.0]
  def change
    change_column_null :task_recommendations, :task_session_id, true
    add_reference :task_recommendations, :surface_item, foreign_key: true
    add_column :task_recommendations, :action_id, :string
    add_check_constraint :task_recommendations,
      "task_session_id IS NOT NULL OR surface_item_id IS NOT NULL",
      name: "task_recommendations_source_check"
  end
end
