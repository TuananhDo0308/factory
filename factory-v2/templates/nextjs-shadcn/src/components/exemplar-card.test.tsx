import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ExemplarCard } from "@/components/exemplar-card";

describe("ExemplarCard", () => {
  it("toggles status badge and button label when confirmed", async () => {
    const user = userEvent.setup();
    render(<ExemplarCard title="Factory v2" description="Harness ready" />);

    expect(screen.getByRole("heading", { name: "Factory v2" })).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm setup" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm setup" }));

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmed" })).toBeInTheDocument();
  });
});
