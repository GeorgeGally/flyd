import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item"]

  focusIntent() {
    this.element.dataset.intentActive = "true"

    this.itemTargets.forEach((item, index) => {
      item.classList.toggle("md:col-span-7", index === 0)
      item.classList.toggle("md:col-span-3", index > 0)
      item.classList.toggle("opacity-45", index > 1)
      item.classList.toggle("translate-x-3", index > 0)
    })
  }

  resizeIntent() {
    const input = this.inputTarget
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`
  }
}
