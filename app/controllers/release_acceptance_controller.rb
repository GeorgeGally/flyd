class ReleaseAcceptanceController < ApplicationController
  def show
    @report = ReleaseAcceptance::Report.call
  end
end
