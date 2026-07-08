class ApplicationController < ActionController::Base
  allow_browser versions: :modern

  before_action :check_api_keys
  before_action :load_sidebar_projects

  private

  def check_api_keys
    return if controller_name == "settings"
    return if Flyd::KeyLoader.get("OPENAI_API_KEY") || Flyd::KeyLoader.get("ANTHROPIC_API_KEY")
    redirect_to settings_path
  end

  def load_sidebar_projects
    @active_projects = Project.active.by_recent_activity
    @archived_projects = Project.archived.by_recent_activity
  end
end
