/**
 * His own to-dos, drawn into Needs you: what he must do himself, as the server read it. A tick
 * goes to /api/todos and the list comes back from the store, so the page
 * never keeps a second copy. Borrows frontEsc, frontHeading, frontSelect and
 * VIEW_TOKEN from the page's closure.
 */
export const TODOS_SCRIPT = `
  var todoLists = document.getElementById("todo-lists");
  var todoSaid = document.getElementById("todo-said");
  var todosDrawn = "";
  function todoRow(row) {
    var words = row.job ? frontHeading(row.text) : row.text;
    var text = row.job
      ? '<button type="button" class="todo-text" data-job="' + frontEsc(row.job) + '">' + frontEsc(words) + '</button>'
      : '<span class="todo-text">' + frontEsc(words) + '</span>';
    return '<div class="todo">'
      + '<input type="checkbox" class="todo-tick" data-id="' + frontEsc(row.id) + '" aria-label="Done: ' + frontEsc(words) + '"'
      + (VIEW_TOKEN ? "" : " disabled") + '>'
      + '<div>' + text + (row.line ? '<p class="todo-line">' + frontEsc(row.line) + '</p>' : "") + '</div></div>';
  }
  function drawTodos(list) {
    // A Flyd ask already has its own card in Needs you: only what is his alone is listed here.
    list = list.filter(function (row) { return !row.job; });
    var html = list.length ? '<div class="fstrip todo-list">' + list.map(todoRow).join("") + '</div>' : "";
    if (html === todosDrawn) return;
    todosDrawn = html;
    todoLists.innerHTML = html;
    if (typeof frontNeedsCount === "function") frontNeedsCount();
  }
  function todoSay(words) {
    todoSaid.textContent = words || "";
    todoSaid.hidden = !words;
  }
  // The list that comes back is the truth. Without one, the caller puts his action back.
  function postTodo(body, failed) {
    todoSay("");
    return fetch("/api/todos", { method: "POST", headers: { "content-type": "application/json", "x-flyd-view-token": VIEW_TOKEN }, body: JSON.stringify(body) })
      .then(function (response) {
        return response.json().then(function (data) {
          if (data.todos) drawTodos(data.todos);
          if (!response.ok) throw new Error(data.error || "");
        });
      })
      .catch(function () { failed(); todoSay("That did not save. Try again."); });
  }
  todoLists.addEventListener("change", function (event) {
    var box = event.target.closest(".todo-tick");
    if (!box) return;
    var at = Array.from(todoLists.querySelectorAll(".todo-tick")).indexOf(box);
    box.disabled = true;
    postTodo({ op: "tick", id: box.dataset.id }, function () {
      box.checked = false;
      box.disabled = false;
    }).then(function () {
      // The row he was on has gone: the keyboard stays where it was in the list.
      if (document.activeElement && document.activeElement !== document.body) return;
      var next = todoLists.querySelectorAll(".todo-tick")[at];
      if (next) next.focus();
    });
  });
  todoLists.addEventListener("click", function (event) {
    var open = event.target.closest(".todo-text[data-job]");
    if (open) frontSelect(open.dataset.job);
  });
`;
