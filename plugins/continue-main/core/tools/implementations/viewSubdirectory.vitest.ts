import { describe, expect, it, vi } from "vitest";
import { XynapseError, XynapseErrorReason } from "../../util/errors";
import { viewSubdirectoryImpl } from "./viewSubdirectory";

describe("viewSubdirectoryImpl", () => {
  it("should throw DirectoryNotFound when resolveInputPath returns null", async () => {
    const mockExtras = {
      ide: {
        fileExists: vi.fn().mockResolvedValue(false),
        getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace"]),
      },
      llm: {},
    };

    // resolveInputPath will return null when path doesn't exist
    await expect(
      viewSubdirectoryImpl(
        { directory_path: "/non/existent/path" },
        mockExtras as any,
      ),
    ).rejects.toThrow(XynapseError);
  });

  it("should throw DirectoryNotFound when path exists in resolveInputPath but not on filesystem", async () => {
    const mockExtras = {
      ide: {
        fileExists: vi.fn().mockResolvedValue(false), // Path doesn't exist
        getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace"]),
      },
      llm: {},
    };

    // This test verifies the fix - even if resolveInputPath returns a valid object,
    // we still check if the path exists and throw if it doesn't
    try {
      await viewSubdirectoryImpl(
        { directory_path: "/some/absolute/path" },
        mockExtras as any,
      );
      expect.fail("Should have thrown DirectoryNotFound error");
    } catch (error) {
      expect(error).toBeInstanceOf(XynapseError);
      expect((error as XynapseError).reason).toBe(
        XynapseErrorReason.DirectoryNotFound,
      );
      expect((error as XynapseError).message).toContain(
        "does not exist or is not accessible",
      );
    }
  });
});
