import { resolveRelativePathInDir } from "core/util/ideUtils";
import { v4 as uuid } from "uuid";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolImpl } from "./callClientTool";

export const editToolImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  if (!args.filepath || !args.changes) {
    throw new Error(
      "`filepath` and `changes` arguments are required to edit an existing file.",
    );
  }
  let filepath = args.filepath;
  if (filepath.startsWith("./")) {
    filepath = filepath.slice(2);
  }

  // Normalize backslashes to forward slashes
  filepath = filepath.replace(/\\/g, "/");

  // If absolute path, try to extract workspace-relative part
  if (/^[a-zA-Z]:/.test(filepath) || filepath.startsWith("/")) {
    const dirs = await extras.ideMessenger.ide.getWorkspaceDirs();
    for (const dirUri of dirs) {
      // Extract OS path from URI: file:///c%3A/Users/... → c:/Users/...
      const dirPath = decodeURIComponent(
        dirUri.replace(/^file:\/\/\//, ""),
      ).replace(/\/$/, "");
      if (
        filepath.toLowerCase().startsWith(dirPath.toLowerCase() + "/")
      ) {
        filepath = filepath.substring(dirPath.length + 1);
        break;
      }
    }
  }

  let firstUriMatch = await resolveRelativePathInDir(
    filepath,
    extras.ideMessenger.ide,
  );

  if (!firstUriMatch) {
    const openFiles = await extras.ideMessenger.ide.getOpenFiles();
    for (const uri of openFiles) {
      if (uri.endsWith(filepath)) {
        firstUriMatch = uri;
        break;
      }
    }
  }

  if (!firstUriMatch) {
    throw new Error(`${filepath} does not exist`);
  }
  const streamId = uuid();
  void extras.dispatch(
    applyForEditTool({
      streamId,
      text: args.changes,
      toolCallId,
      filepath: firstUriMatch,
    }),
  );

  return {
    respondImmediately: false,
    output: undefined, // no immediate output - output for edit tools should be added based on apply state coming in
  };
};
