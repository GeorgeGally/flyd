class IntentAttachmentsController < ApplicationController
  def show
    attachment = IntentAttachment.find(params[:id])
    send_data(
      attachment.data,
      filename: attachment.filename.presence || "attachment",
      type: attachment.content_type.presence || "application/octet-stream",
      disposition: attachment.content_type.to_s.start_with?("image/", "audio/") ? "inline" : "attachment"
    )
  end
end
