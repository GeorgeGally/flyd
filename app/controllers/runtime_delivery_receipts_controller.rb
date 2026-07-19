class RuntimeDeliveryReceiptsController < ApplicationController
  def create
    event = RuntimeEvent.find(params.require(:runtime_event_id))
    return head :unprocessable_entity unless event.broadcast_delivered_at?

    acknowledged_at = Time.current
    receipt = RuntimeDeliveryReceipt.create_or_find_by!(
      runtime_event: event,
      client_id: params.require(:client_id).to_s.first(120)
    ) do |record|
      record.surface_id = params[:surface_id]
      record.acknowledged_at = acknowledged_at
      record.delivery_latency_ms = [ ((acknowledged_at - event.occurred_at) * 1_000).round, 0 ].max
    end
    render json: { acknowledged: true, delivery_latency_ms: receipt.delivery_latency_ms }
  end
end
