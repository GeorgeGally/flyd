class SurfacesController < ApplicationController
  def show
    @surface = Surface::Planner.call
  end
end
