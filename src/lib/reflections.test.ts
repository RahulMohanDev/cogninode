// src/lib/reflections.test.ts
import { describe, it, expect } from "vitest";
import {
  composeReflectionBody,
  deriveReflectionTitle,
  type ReflectionSourceMessage,
} from "./reflections";

const PATH: ReflectionSourceMessage[] = [
  { role: "user",      content: "What is a monad?" },
  { role: "assistant", content: "A monad is a wrapper.", reasoning: "Think simple.\nAvoid jargon." },
];

describe("composeReflectionBody", () => {
  it("joins messages with speaker headers and --- separators", () => {
    const body = composeReflectionBody(PATH, { includeReasoning: false });
    expect(body).toBe(
      "**You**\n\nWhat is a monad?\n\n---\n\n**Assistant**\n\nA monad is a wrapper.",
    );
  });

  it("drops reasoning by default", () => {
    const body = composeReflectionBody(PATH, { includeReasoning: false });
    expect(body).not.toContain("Reasoning");
    expect(body).not.toContain("Think simple.");
  });

  it("renders reasoning as a blockquote above the answer when included", () => {
    const body = composeReflectionBody(PATH, { includeReasoning: true });
    expect(body).toContain(
      "**Assistant**\n\n> _Reasoning_\n>\n> Think simple.\n> Avoid jargon.\n\nA monad is a wrapper.",
    );
  });

  it("ignores reasoning on user messages and blank reasoning", () => {
    const body = composeReflectionBody(
      [
        { role: "user",      content: "hi", reasoning: "should never render" },
        { role: "assistant", content: "hello", reasoning: "   " },
      ],
      { includeReasoning: true },
    );
    expect(body).not.toContain("Reasoning");
    expect(body).not.toContain("should never render");
  });
});

describe("deriveReflectionTitle", () => {
  it("prefers the node label, then the chat title, then a fallback", () => {
    expect(deriveReflectionTitle("Branch label", "Chat title")).toBe("Branch label");
    expect(deriveReflectionTitle("   ",          "Chat title")).toBe("Chat title");
    expect(deriveReflectionTitle(undefined,      "  ")).toBe("Reflection");
  });

  it("truncates titles longer than 80 chars with an ellipsis", () => {
    const long = "x".repeat(100);
    const title = deriveReflectionTitle(long, "chat");
    expect(title).toHaveLength(81);
    expect(title.endsWith("…")).toBe(true);
  });
});
