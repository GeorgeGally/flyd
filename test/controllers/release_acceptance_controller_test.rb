require "test_helper"

class ReleaseAcceptanceControllerTest < ActionDispatch::IntegrationTest
  test "reports an unqualified gate when persisted evidence is absent" do
    get release_acceptance_path

    assert_response :success
    assert_select "h1", "Acceptance"
    assert_select "[data-acceptance-status='insufficient_evidence']"
    assert_select "body", text: /remains unqualified/
    assert_select "aside", count: 0
  end
end
