import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Stepper, StepperItem, StepperNav, StepperTitle } from "./stepper"

function progress(props: { role?: string; nav?: "nav" | "div" } = {}) {
  return render(
    <Stepper value={2} role={props.role} aria-label="Các bước">
      <StepperNav as={props.nav}>
        <StepperItem step={1}>
          <StepperTitle>Một</StepperTitle>
        </StepperItem>
        <StepperItem step={2}>
          <StepperTitle>Hai</StepperTitle>
        </StepperItem>
      </StepperNav>
    </Stepper>
  )
}

/*
 * A Stepper used as progress, not as tabs, overrides the root role. Its
 * aria-orientation then has to go: the attribute is not allowed on `group`,
 * and an axe run flags it. Its nav has to be able to stop being a landmark
 * too, so a progress row does not add a "navigation" entry a screen-reader
 * user would jump to and find nothing to navigate.
 */
describe("Stepper ARIA", () => {
  it("keeps the tablist and its orientation by default", () => {
    progress()
    const root = screen.getByRole("tablist", { name: "Các bước" })
    expect(root).toHaveAttribute("aria-orientation", "horizontal")
    expect(screen.getByRole("navigation")).toBeInTheDocument()
  })

  it("drops aria-orientation when the role is overridden to group", () => {
    progress({ role: "group" })
    const root = screen.getByRole("group", { name: "Các bước" })
    expect(root).not.toHaveAttribute("aria-orientation")
    // The layout hook still reads the orientation.
    expect(root).toHaveAttribute("data-orientation", "horizontal")
  })

  it("renders the nav as a plain element on request", () => {
    progress({ role: "group", nav: "div" })
    expect(screen.queryByRole("navigation")).toBeNull()
    const nav = document.querySelector('[data-slot="stepper-nav"]')
    expect(nav?.tagName).toBe("DIV")
    expect(nav).toHaveAttribute("data-orientation", "horizontal")
  })

  it("keeps StepperTitle a span, not a heading", () => {
    progress()
    expect(screen.getByText("Hai").tagName).toBe("SPAN")
    expect(screen.queryByRole("heading")).toBeNull()
  })
})
