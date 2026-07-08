class CreateCaptureImports < ActiveRecord::Migration[8.0]
  def change
    create_table :capture_imports do |t|
      t.string :source_file
      t.string :content_hash
      t.string :project
      t.datetime :timestamp
      t.string :session_id
      t.string :source_type
      t.text :body
      t.datetime :imported_at
      t.index :content_hash, unique: true
      t.index :source_file

      t.timestamps
    end
  end
end
