import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item", "conversation"]

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
    this.itemTargets.forEach((item) => {
      const behaviours = (item.dataset.behaviours || "").split(" ")
      const depth = item.dataset.depth
      const yields = behaviours.includes("yield") || behaviours.includes("recede") || depth === "background" || depth === "receded"
      const joins = behaviours.includes("join") || depth === "foreground"
      const leaves = behaviours.includes("leave")

      item.classList.toggle("md:col-span-7", active && joins)
      item.classList.toggle("md:col-span-3", active && yields)
      item.classList.toggle("opacity-40", active && yields)
      item.classList.toggle("translate-x-3", active && yields)
      item.classList.toggle("pointer-events-none", active && leaves)
      item.classList.toggle("opacity-0", active && leaves)
      item.classList.toggle("blur-[1px]", active && depth === "receded")
    })
  }
}
