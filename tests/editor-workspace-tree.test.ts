import { describe, expect, it } from "vitest";
import { buildWorkspaceTree } from "@/components/editor/panels/workspace-tree-panel";

describe("editor Workspace worktree", () => {
  it("builds folders from presentation-only relative paths and preserves UUID openability", () => {
    const tree = buildWorkspaceTree([
      {
        id: "a",
        name: "First.md",
        relativePath: "Letters/2026/First.md",
        state: "synced",
        status: "draft",
        excerpt: null,
        modifiedAt: 0,
        openable: true,
      },
      {
        id: null,
        name: "Ambiguous.md",
        relativePath: "Letters/Ambiguous.md",
        state: "ambiguous",
        status: "draft",
        excerpt: null,
        modifiedAt: 0,
        openable: false,
      },
      {
        id: "b",
        name: "Root.md",
        relativePath: "Root.md",
        state: "local-only",
        status: "draft",
        excerpt: null,
        modifiedAt: 0,
        openable: true,
      },
    ]);

    expect(tree.documents.map((item) => item.id)).toEqual(["b"]);
    expect(tree.folders[0]?.name).toBe("Letters");
    expect(tree.folders[0]?.folders[0]?.documents[0]?.id).toBe("a");
    expect(tree.folders[0]?.documents[0]).toMatchObject({
      id: null,
      excerpt: null,
      modifiedAt: 0,
      openable: false,
    });
  });

  it("accepts Windows separators without exposing an absolute root", () => {
    const tree = buildWorkspaceTree([
      {
        id: "a",
        name: "Draft.md",
        relativePath: "Folder\\Draft.md",
        state: "pending",
        status: "draft",
        excerpt: null,
        modifiedAt: 0,
        openable: true,
      },
    ]);
    expect(tree.folders[0]?.path).toBe("Folder");
    expect(JSON.stringify(tree)).not.toContain(":\\");
  });
});
