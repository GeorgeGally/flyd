class RuntimeDeliveryReceiptsController < ApplicationController
  def create
    event = RuntimeEvent.find(params.require(:runtime_event_id))
    return head :unprocessable_entity unless event.broadcast_delivered_at?
    surface = Surface.find_by(id: params.require(:surface_id))
    item = surface&.items&.find { |candidate| bound_to_event?(candidate, event) }
    return head :unprocessable_entity unless surface&.active? && item
    return head :unprocessable_entity unless item.metadata["task_revision"] == event.task_revision
    return head :unprocessable_entity unless event.agent_task.revision == event.task_revision

    acknowledged_at = Time.current
    binding_digest = RuntimeTasks::BindingDigest.call(task: event.agent_task, item: item)
    rendered_digest = params.require(:binding_digest).to_s
    return head :unprocessable_entity unless ActiveSupport::SecurityUtils.secure_compare(rendered_digest, binding_digest)
    receipt = RuntimeDeliveryReceipt.create_or_find_by!(
      runtime_event: event,
      client_id: params.require(:client_id).to_s.first(120)
    ) do |record|
      record.surface_id = surface.id
      record.task_revision = event.task_revision
      record.binding_digest = binding_digest
      record.acknowledged_at = acknowledged_at
      record.delivery_latency_ms = [ ((acknowledged_at - event.occurred_at) * 1_000).round, 0 ].max
    end
    render json: { acknowledged: true, delivery_latency_ms: receipt.delivery_latency_ms }
  end

  private

  def bound_to_event?(item, event)
    Array(item.source_refs).any? do |reference|
      reference.to_h.deep_stringify_keys == { "type" => "runtime_task", "id" => event.agent_task.task_key }
    end
  end
end
