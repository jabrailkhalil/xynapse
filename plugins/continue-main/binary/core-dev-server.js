const path = require("path");
process.env.CONTINUE_DEVELOPMENT = true;

process.env.CONTINUE_GLOBAL_DIR = path.join(
  process.env.PROJECT_DIR,
  "extensions",
  ".xynapse-debug",
);

require("./out/index.js");
