import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item", "conversation", "launcher"]

  connect() {
    this.handleMorph = this.handleMorph.bind(this)
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this)
    document.addEventListener("turbo:morph", this.handleMorph)
    document.addEventListener("keydown", this.handleGlobalKeydown)
    this.applySemanticLayout(this.element.dataset.intentActive === "true")
  }

  disconnect() {
    document.removeEventListener("turbo:morph", this.handleMorph)
    document.removeEventListener("keydown", this.handleGlobalKeydown)
  }

  handleMorph() {
    this.applySemanticLayout(this.element.dataset.intentActive === "true")
  }

  focusIntent() {
    this.element.dataset.intentActive = "true"
    this.intentTarget.setAttribute("aria-hidden", "false")
    this.applySemanticLayout(true)
  }

  openIntent(event) {
    event?.preventDefault()
    this.focusIntent()
    window.requestAnimationFrame(() => this.inputTarget.focus())
  }

  closeIntent(event) {
    event?.preventDefault()
    delete this.element.dataset.intentActive
    this.intentTarget.setAttribute("aria-hidden", "true")
    this.inputTarget.blur()
    this.applySemanticLayout(false)
    if (event?.type === "click" && this.hasLauncherTarget) this.launcherTarget.focus()
  }

  handleGlobalKeydown(event) {
    if (event.key === "/" && !this.editingText()) this.openIntent(event)
    if (event.key === "Escape" && this.element.dataset.intentActive === "true") this.closeIntent(event)
  }

  releaseIntent(event) {
    if (event?.type === "keydown") return this.closeIntent(event)
    window.setTimeout(() => {
      if (!this.intentTarget.contains(document.activeElement)) {
        delete this.element.dataset.intentActive
        this.intentTarget.setAttribute("aria-hidden", "true")
        this.applySemanticLayout(false)
      }
    }, 0)
  }

  resizeIntent() {
    const input = this.inputTarget
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`
  }

  applySemanticLayout(active) {
    const focusKey = this.hasPlaneTarget ? this.planeTarget.dataset.surfaceFocusKey : null

    this.itemTargets.forEach((item) => {
      const incoming = this.behaviours(item.dataset.incomingBehaviours)
      const outgoing = this.behaviours(item.dataset.outgoingBehaviours)
      const depth = item.dataset.depth
      const isFocus = item.dataset.itemKey === focusKey
      const returning = incoming.includes("return") || outgoing.includes("return")
      const yielding = !returning && (incoming.includes("yield") || incoming.includes("recede") || depth === "background" || depth === "receded")
      const leaving = !returning && incoming.includes("leave")
      const replacing = !returning && incoming.includes("replace")
      const collapsing = !returning && incoming.includes("collapse")
      const joining = returning || isFocus || incoming.includes("join")

      item.classList.toggle("opacity-35", active && yielding)
      item.classList.toggle("translate-x-8", active && yielding)
      item.classList.toggle("blur-[1px]", active && (yielding || depth === "receded"))
      item.classList.toggle("opacity-0", active && (leaving || replacing || collapsing))
      item.classList.toggle("-translate-y-6", active && leaving)
      item.classList.toggle("scale-95", active && replacing)
      item.classList.toggle("max-h-0", active && collapsing)
      item.classList.toggle("overflow-hidden", active && collapsing)
      item.classList.toggle("pointer-events-none", active && (leaving || replacing || collapsing))
      item.classList.toggle("scale-[1.015]", active && joining)
      item.classList.toggle("z-30", active && joining)
    })
  }

  behaviours(value) {
    return (value || "").split(" ").filter(Boolean)
  }

  editingText() {
    const element = document.activeElement
    return element?.matches("input, textarea, select, [contenteditable='true']")
  }
}
