class SurfaceItemSourcesController < ApplicationController
  def show
    @item = SurfaceItem.find(params[:surface_item_id])
    @surface = @item.surface
    @sources = SurfaceSourceResolver.new(@surface).call(@item.source_refs)
  end
end
