class IntentAttachmentsController < ApplicationController
  def show
    attachment = IntentAttachment.available.find(params[:id])
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'; media-src 'self'; img-src 'self' data:"

    send_data(
      attachment.data,
      filename: attachment.filename.presence || "attachment",
      type: attachment.content_type.presence || "application/octet-stream",
      disposition: attachment.safe_inline? ? "inline" : "attachment"
    )
  end
end
