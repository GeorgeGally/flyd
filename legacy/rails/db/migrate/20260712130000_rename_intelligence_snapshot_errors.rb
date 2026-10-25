class RenameIntelligenceSnapshotErrors < ActiveRecord::Migration[8.0]
  def up
    return unless column_exists?(:intelligence_snapshots, :errors)
    return if column_exists?(:intelligence_snapshots, :provider_errors)

    rename_column :intelligence_snapshots, :errors, :provider_errors
  end

  def down
    return unless column_exists?(:intelligence_snapshots, :provider_errors)
    return if column_exists?(:intelligence_snapshots, :errors)

    rename_column :intelligence_snapshots, :provider_errors, :errors
  end
end
