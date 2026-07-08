class CaptureImport < ApplicationRecord
  belongs_to :flyd_project, class_name: "Project", foreign_key: :project, primary_key: :name, optional: true, inverse_of: :capture_imports

  validates :content_hash, uniqueness: true, allow_nil: true
  validates :source_file, presence: true

  scope :by_timestamp, -> { order(timestamp: :desc) }
  scope :for_project, ->(name) { where(project: name) }
end
