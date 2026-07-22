class BindRuntimeDeliveryReceiptsToSurfaceItems < ActiveRecord::Migration[8.0]
  def change
    add_reference :runtime_delivery_receipts, :surface_item, foreign_key: true
  end
end
