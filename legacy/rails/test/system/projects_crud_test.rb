require "application_system_test_case"

class ProjectsCrudTest < ApplicationSystemTestCase
  test "create project" do
    visit projects_path
    click_on "Create Project"
    assert_selector "h2", text: "New Project"

    fill_in "Project name", with: "My First Project"
    fill_in "What is this project about?", with: "A test project for system tests"
    click_on "Create Project"

    assert_selector "h2", text: "Here's where we are"
    assert_text "My First Project"
    assert_text "A test project for system tests"
  end

  test "list projects on index" do
    Project.create!(name: "Alpha")
    Project.create!(name: "Beta")

    visit projects_path
    within "main" do
      assert_text "Alpha"
      assert_text "Beta"
    end
  end

  test "edit project" do
    Project.create!(name: "Original")
    visit project_path(Project.last)
    click_on "Edit"

    assert_selector "h2", text: "Edit Project"
    fill_in "Project name", with: "Renamed"
    click_on "Update Project"

    assert_selector "h2", text: "Here's where we are"
    assert_text "Renamed"
  end

  test "archive and reactivate project" do
    Project.create!(name: "Temporary")
    visit project_path(Project.last)
    click_on "Archive"

    assert_selector "h2", text: "Projects"

    visit project_path(Project.last)
    assert_text "This project is archived"
    click_on "Reactivate"

    assert_selector "h2", text: "Here's where we are"
    assert_text "Temporary"
    assert_no_text "This project is archived"
  end

  test "delete project with confirmation" do
    Project.create!(name: "Disposable")
    visit project_path(Project.last)
    accept_confirm do
      click_on "Delete"
    end

    assert_selector "h2", text: "Projects"
    assert_no_text "Disposable"
  end

  test "empty state shows guidance" do
    Project.delete_all
    visit projects_path
    assert_text "No projects yet"
    assert_text "Create your first project"
  end
end
