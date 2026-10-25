class AddProviderIdentityToTaskGrants < ActiveRecord::Migration[8.0]
  def change
    add_column :task_grants, :provider_identity, :string, null: false, default: "opencode-configured-provider"
  end
end
