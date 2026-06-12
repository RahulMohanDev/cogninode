import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ crash }: { crash: boolean }): React.ReactElement {
  if (crash) throw new Error("kaboom");
  return <div>healthy child</div>;
}

describe("ErrorBoundary", () => {
  // React logs caught errors to console.error — silence it for clean output.
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("renders children when they don't throw", () => {
    render(
      <ErrorBoundary resetKeys={[1]}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeTruthy();
  });

  it("catches a throw and shows the recovery fallback instead of blanking", () => {
    render(
      <ErrorBoundary resetKeys={[1]}>
        <Boom crash={true} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText("healthy child")).toBeNull();
    expect(screen.getByText(/hiccup and is recovering/i)).toBeTruthy();
  });

  it("auto-recovers when resetKeys change after a crash", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={[1]}>
        <Boom crash={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/hiccup/i)).toBeTruthy();

    // New data tick (resetKeys changed) + the condition that caused the throw
    // is gone → children render again, no blank, no manual reload.
    rerender(
      <ErrorBoundary resetKeys={[2]}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeTruthy();
    expect(screen.queryByText(/hiccup/i)).toBeNull();
  });

  it("stays in the fallback while resetKeys are unchanged", () => {
    const { rerender } = render(
      <ErrorBoundary resetKeys={[1]}>
        <Boom crash={true} />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKeys={[1]}>
        <Boom crash={false} />
      </ErrorBoundary>,
    );
    // Same keys → boundary holds the fallback (no thrash); recovery is tied
    // to a real data change.
    expect(screen.getByText(/hiccup/i)).toBeTruthy();
  });
});
