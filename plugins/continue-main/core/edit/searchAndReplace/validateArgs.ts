import { IDE } from "../..";
import { XynapseError, XynapseErrorReason } from "../../util/errors";
import { resolveRelativePathInDir } from "../../util/ideUtils";

export async function validateSearchAndReplaceFilepath(
  filepath: unknown,
  ide: IDE,
) {
  if (!filepath || typeof filepath !== "string") {
    throw new XynapseError(
      XynapseErrorReason.FindAndReplaceMissingFilepath,
      "filepath (string) is required",
    );
  }

  // Normalize backslashes and handle absolute paths
  let normalizedPath = filepath.replace(/\\/g, "/");
  if (/^[a-zA-Z]:/.test(normalizedPath) || normalizedPath.startsWith("/")) {
    const dirs = await ide.getWorkspaceDirs();
    for (const dirUri of dirs) {
      const dirPath = decodeURIComponent(
        dirUri.replace(/^file:\/\/\//, ""),
      ).replace(/\/$/, "");
      if (
        normalizedPath
          .toLowerCase()
          .startsWith(dirPath.toLowerCase() + "/")
      ) {
        normalizedPath = normalizedPath.substring(dirPath.length + 1);
        break;
      }
    }
  }

  const resolvedFilepath = await resolveRelativePathInDir(normalizedPath, ide);
  if (!resolvedFilepath) {
    throw new XynapseError(
      XynapseErrorReason.FileNotFound,
      `File ${filepath} does not exist`,
    );
  }
  return resolvedFilepath;
}
