/**
 * The Todo tab: what he must do himself, as the server read it. A tick or a new
 * item goes to /api/todos and the list comes back from the store, so the page
 * never keeps a second copy. Borrows frontEsc, frontHeading, frontSelect and
 * VIEW_TOKEN from the page's closure.
 */
export const TODOS_SCRIPT = `
  var todoLists = document.getElementById("todo-lists");
  var todoForm = document.getElementById("todo-new");
  var todoInput = document.getElementById("todo-input");
  var todoSaid = document.getElementById("todo-said");
  var todosDrawn = "";
  function todoRow(row, done) {
    var words = frontHeading(row.text);
    var text = row.job && !done
      ? '<button type="button" class="todo-text" data-job="' + frontEsc(row.job) + '">' + frontEsc(words) + '</button>'
      : '<span class="todo-text">' + frontEsc(words) + '</span>';
    return '<div class="todo' + (done ? " done" : "") + '">'
      + '<input type="checkbox" class="todo-tick" data-id="' + frontEsc(row.id) + '" aria-label="' + (done ? "Not done: " : "Done: ") + frontEsc(words) + '"'
      + (done ? " checked" : "") + (VIEW_TOKEN ? "" : " disabled") + '>'
      + '<div>' + text + (row.line ? '<p class="todo-line">' + frontEsc(row.line) + '</p>' : "") + '</div></div>';
  }
  function drawTodos(list) {
    todoForm.hidden = !VIEW_TOKEN;
    var html = (list.open.length
      ? '<div class="fstrip todo-list">' + list.open.map(function (row) { return todoRow(row, false); }).join("") + '</div>'
      : '<p class="fempty">Nothing for you to do.</p>')
      + (list.done.length
        ? '<h2 class="todo-done-head">Done</h2><div class="fstrip todo-list">' + list.done.map(function (row) { return todoRow(row, true); }).join("") + '</div>'
        : "");
    if (html === todosDrawn) return;
    todosDrawn = html;
    todoLists.innerHTML = html;
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
    var ticking = box.checked;
    var at = Array.from(todoLists.querySelectorAll(".todo-tick")).indexOf(box);
    box.disabled = true;
    postTodo({ op: ticking ? "tick" : "untick", id: box.dataset.id }, function () {
      box.checked = !ticking;
      box.disabled = false;
    }).then(function () {
      // The row he was on may have moved: the keyboard stays where it was in the list.
      if (document.activeElement && document.activeElement !== document.body) return;
      var next = todoLists.querySelectorAll(".todo-tick")[at];
      (next || todoInput).focus();
    });
  });
  todoLists.addEventListener("click", function (event) {
    var open = event.target.closest(".todo-text[data-job]");
    if (open) frontSelect(open.dataset.job);
  });
  todoForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = todoInput.value.trim();
    if (!text) return;
    var add = todoForm.querySelector("button");
    add.disabled = true;
    todoInput.value = "";
    postTodo({ op: "add", text: text }, function () { if (!todoInput.value) todoInput.value = text; })
      .then(function () { add.disabled = false; });
  });
`;
