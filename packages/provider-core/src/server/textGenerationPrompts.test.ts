import { describe, expect, it } from "vite-plus/test";

import { PAGE_EDIT_CURSOR_MARKER } from "@t3tools/contracts";

import { buildPageEditPrompt, buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("names the project to leave out and puts the user's instructions above the limits", () => {
    for (const previousTitle of [undefined, "Hyperdrive Config Crash"]) {
      const { prompt } = buildThreadTitlePrompt({
        message: "hyperdrive init crashes without a config",
        previousTitle,
        projectTitle: "Hyperdrive",
        instructions: "Prefix every title with the team name.",
      });
      expect(prompt).toContain('Never include the project name ("Hyperdrive")');
      expect(prompt).not.toContain("fewer than 40 characters");
      expect(prompt).toContain("Title instructions from the user:\nPrefix every title");
    }
    expect(buildThreadTitlePrompt({ message: "Fix login", instructions: " " }).prompt).toContain(
      "3-8 words, fewer than 40 characters.",
    );
  });
});

describe("buildPageEditPrompt", () => {
  const page = `# Plan\n\nShip it.\n\n${PAGE_EDIT_CURSOR_MARKER}`;

  it("sends only the selection to rewrite in replace mode", () => {
    const { prompt } = buildPageEditPrompt({
      instruction: "Shorter",
      pageTitle: "Launch",
      documentMarkdown: page,
      mode: "replace",
      targetMarkdown: "Ship it.",
    });
    expect(prompt).toContain("Return only its replacement");
    expect(prompt).toContain("Selected part to rewrite:\nShip it.");
  });

  it("writes at the cursor in insert mode, and treats an empty selection as an insert", () => {
    for (const mode of ["insert", "replace"] as const) {
      const { prompt } = buildPageEditPrompt({
        instruction: "Add risks",
        pageTitle: "",
        documentMarkdown: page,
        mode,
        targetMarkdown: "  ",
      });
      expect(prompt).toContain(`insert where ${PAGE_EDIT_CURSOR_MARKER} appears`);
      expect(prompt).toContain("Page title: Untitled");
      expect(prompt).not.toContain("Selected part to rewrite");
    }
  });
});
