class Api::ComposeController < ApplicationController
  skip_before_action :verify_authenticity_token

  def create
    intent = params[:intent].to_s.strip
    environment = params[:environment] || {}

    if intent.blank?
      render json: { error: "intent is required" }, status: :unprocessable_entity
      return
    end

    ComposeSurfaceJob.perform_later(
      reason: "overlay_escalation",
      metadata: {
        escalation_intent: intent,
        environment_application: environment.dig(:application, :bundle_id),
        environment_surface: environment.dig(:surface, :title),
        environment_sufficiency: environment[:sufficiency]
      }
    )

    surface_url = Rails.application.routes.url_helpers.surface_url

    render json: {
      status: "composing",
      surface_url: surface_url
    }
  end
end
