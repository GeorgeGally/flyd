class AddUniqueIndexProjectName < ActiveRecord::Migration[8.0]
  def change
    add_index :projects, :name, unique: true
  end
end
