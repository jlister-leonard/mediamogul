import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

// Vitest globals are off, so testing-library's automatic cleanup never hooks in.
afterEach(cleanup);
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import { Input } from "./Input";
import { RatingGradient, type RatingValue } from "./RatingGradient";
import { Tabs } from "./Tabs";

describe("Button", () => {
  test("defaults to type=button and renders its name", () => {
    render(<Button>Log it</Button>);
    const button = screen.getByRole("button", { name: "Log it" });
    expect(button.getAttribute("type")).toBe("button");
  });

  test("respects an explicit submit type", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });
});

describe("Chip", () => {
  test("exposes aria-pressed only when used as a toggle", () => {
    const { rerender } = render(<Chip>Pacing</Chip>);
    expect(screen.getByRole("button").hasAttribute("aria-pressed")).toBe(false);
    rerender(<Chip selected>Pacing</Chip>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    rerender(<Chip selected={false}>Pacing</Chip>);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Card", () => {
  test("renders the requested semantic element", () => {
    render(
      <Card as="article" aria-label="A cover card">
        content
      </Card>,
    );
    expect(screen.getByRole("article").textContent).toBe("content");
  });
});

describe("Input", () => {
  test("associates label and hint with the field", () => {
    render(<Input label="Note" hint="Saved with the entry." />);
    const input = screen.getByLabelText("Note");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "Saved with the entry.",
    );
  });

  test("omits aria-describedby without a hint", () => {
    render(<Input label="Title" />);
    expect(screen.getByLabelText("Title").hasAttribute("aria-describedby")).toBe(
      false,
    );
  });
});

function TabsHarness() {
  const [value, setValue] = useState("a");
  return (
    <Tabs
      label="Sections"
      tabs={[
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ]}
      value={value}
      onChange={setValue}
    >
      panel for {value}
    </Tabs>
  );
}

describe("Tabs", () => {
  test("marks the active tab selected and labels the panel by it", () => {
    render(<TabsHarness />);
    const alpha = screen.getByRole("tab", { name: "Alpha" });
    expect(alpha.getAttribute("aria-selected")).toBe("true");
    expect(alpha.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(alpha.id);
  });

  test("clicking a tab switches the panel", () => {
    render(<TabsHarness />);
    fireEvent.click(screen.getByRole("tab", { name: "Beta" }));
    expect(screen.getByRole("tabpanel").textContent).toBe("panel for b");
  });

  test("arrow keys move and select, wrapping at the ends", () => {
    render(<TabsHarness />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Gamma" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  });
});

function RatingHarness({ onChange }: { onChange?: (v: RatingValue | null) => void }) {
  const [value, setValue] = useState<RatingValue | null>(null);
  return (
    <RatingGradient
      label="Rate this title"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("RatingGradient", () => {
  test("renders a radiogroup of the four steps, none checked initially", () => {
    render(<RatingHarness />);
    const group = screen.getByRole("radiogroup", { name: "Rate this title" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios.map((r) => r.textContent)).toEqual(["Loved", "Liked", "Fine", "No"]);
    expect(radios.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
  });

  test("one tap selects; tapping the selection again clears it", () => {
    const spy = vi.fn();
    render(<RatingHarness onChange={spy} />);
    const liked = screen.getByRole("radio", { name: "Liked" });
    fireEvent.click(liked);
    expect(spy).toHaveBeenLastCalledWith("liked");
    expect(liked.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(liked);
    expect(spy).toHaveBeenLastCalledWith(null);
    expect(liked.getAttribute("aria-checked")).toBe("false");
  });

  test("arrow keys move and select", () => {
    render(<RatingHarness />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Liked" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(group, { key: "End" });
    expect(screen.getByRole("radio", { name: "No" }).getAttribute("aria-checked")).toBe("true");
  });
});
