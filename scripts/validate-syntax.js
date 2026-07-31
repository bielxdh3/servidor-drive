const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");

function listFiles(args) {
  if (args.length) {
    return args.map((file) => path.resolve(file)).sort();
  }

  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "--", "*.js"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    console.error("Syntax validation failed to enumerate JavaScript files.");
    return null;
  }
  return result.stdout.split(/\r?\n/).filter(Boolean).map((file) => path.join(root, file)).sort();
}

const files = listFiles(process.argv.slice(2));
if (!files || !files.length) {
  console.error("Syntax validation found no eligible JavaScript files.");
  process.exitCode = 1;
} else {
  let failures = 0;
  for (const file of files) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      console.error(`Syntax validation requires a file: ${file}`);
      failures += 1;
      continue;
    }
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.error || result.status !== 0) failures += 1;
  }
  console.log(`Syntax validation: ${files.length} checked, ${failures} failed.`);
  if (failures) process.exitCode = 1;
}
