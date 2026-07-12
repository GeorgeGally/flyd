class IntentsController < ApplicationController
  def create
    text = intent_params[:text].to_s.strip
    clipboard = intent_params[:clipboard].to_s.strip
    uploads = Array(intent_params[:files]).compact
    return redirect_to root_path, alert: "Say, paste, or attach something first." if text.blank? && clipboard.blank? && uploads.empty?

    intent = Intent.transaction do
      intent = Intent.create!(
        input_text: text.presence || clipboard,
        modality: inferred_modality(text:, clipboard:, uploads:),
        origin_surface: Surface.current,
        attachments: uploads.map { |upload| { "filename" => upload.original_filename, "content_type" => upload.content_type } },
        metadata: { "preferred_project_id" => intent_params[:project_id].presence }
      )
      Intents::IngestAttachments.call(intent: intent, uploads: uploads)
      intent.intent_attachments.create!(
        modality: "clipboard",
        filename: "clipboard.txt",
        content_type: "text/plain",
        byte_size: clipboard.bytesize,
        checksum: Digest::SHA256.hexdigest(clipboard),
        extracted_text: clipboard
      ) if clipboard.present?
      intent
    end

    InterpretIntentJob.perform_later(intent.id, preferred_project_id: intent_params[:project_id])
    ComposeSurfaceJob.enqueue(reason: "intent_received", active_intent_id: intent.id)

    redirect_to root_path(intent_id: intent.id), notice: "Flyd is interpreting this."
  rescue ArgumentError => error
    redirect_to root_path, alert: error.message
  end

  private

  def intent_params
    params.require(:intent).permit(:text, :project_id, :modality, :clipboard, files: [])
  end

  def inferred_modality(text:, clipboard:, uploads:)
    return "clipboard" if clipboard.present? && text.blank? && uploads.empty?
    return "text" if uploads.empty?

    content_type = uploads.first.content_type.to_s
    return "image" if content_type.start_with?("image/")
    return "audio" if content_type.start_with?("audio/")

    "file"
  end
end
