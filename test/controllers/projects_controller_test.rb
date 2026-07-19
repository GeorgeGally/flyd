require "test_helper"

class ProjectsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @project = Project.create!(name: "Test Project", description: "A test")
  end

  test "should get index" do
    get projects_url
    assert_response :success
    assert_select "h2", "Projects"
  end

  test "system layout keeps project content usable on mobile" do
    get projects_url

    assert_select "body[class*='flex-col'][class*='md:flex-row']"
    assert_select "aside[class*='hidden'][class*='md:flex']"
    assert_select "header[class*='md:hidden']", text: /Projects/
    assert_select "main[class*='min-w-0']"
  end

  test "should get new" do
    get new_project_url
    assert_response :success
  end

  test "should create project" do
    assert_difference("Project.count") do
      post projects_url, params: { project: { name: "New Project", description: "Created via test" } }
    end

    assert_redirected_to project_url(Project.last)
  end

  test "should not create project with blank name" do
    assert_no_difference("Project.count") do
      post projects_url, params: { project: { name: "" } }
    end

    assert_response :unprocessable_entity
  end

  test "should show project" do
    get project_url(@project)
    assert_response :success
    assert_select "h2", /Here's where we are/
  end

  test "should get edit" do
    get edit_project_url(@project)
    assert_response :success
  end

  test "should update project" do
    patch project_url(@project), params: { project: { name: "Updated Name" } }
    assert_redirected_to project_url(@project)
    @project.reload
    assert_equal "Updated Name", @project.name
  end

  test "should destroy project" do
    assert_difference("Project.count", -1) do
      delete project_url(@project)
    end

    assert_redirected_to projects_url
  end

  test "should archive project" do
    post archive_project_url(@project)
    assert_redirected_to projects_url
    @project.reload
    assert @project.archived?
  end

  test "should reactivate project" do
    @project.archive!
    post reactivate_project_url(@project)
    assert_redirected_to project_url(@project)
    @project.reload
    assert_not @project.archived?
  end
end
