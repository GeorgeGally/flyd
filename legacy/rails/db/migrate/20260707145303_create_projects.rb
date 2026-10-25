class CreateProjects < ActiveRecord::Migration[8.0]
  def change
    create_table :projects do |t|
      t.string :name
      t.text :description
      t.string :root_path
      t.datetime :archived_at
      t.index :archived_at

      t.timestamps
    end
  end
end
