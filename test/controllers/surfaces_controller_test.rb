require "test_helper"

class SurfacesControllerTest < ActionDispatch::IntegrationTest
  test "root renders the intelligence surface without project navigation" do
    Project.create!(name: "Flyd", description: "Personal intelligence")

    get root_url

    assert_response :success
    assert_select "textarea[placeholder='Ask, tell, show…']"
    assert_select "aside", count: 0
  end
end
