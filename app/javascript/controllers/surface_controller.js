import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item", "conversation"]

  connect() {
    this.handleMorph = this.handleMorph.bind(this)
    document.addEventListener("turbo:morph", this.handleMorph)
    this.applySemanticLayout(false)
  }

  disconnect() {
    document.removeEventListener("turbo:morph", this.handleMorph)
  }

  handleMorph() {
    this.applySemanticLayout(this.element.dataset.intentActive === "true")
  }

  focusIntent() {
    this.element.dataset.intentActive = "true"
    this.applySemanticLayout(true)
  }

  releaseIntent(event) {
    if (event?.type === "keydown") this.inputTarget.blur()
    window.setTimeout(() => {
      if (!this.intentTarget.contains(document.activeElement)) {
        delete this.element.dataset.intentActive
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
}
