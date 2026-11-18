#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const ENTRY = path.join(REPO_ROOT, "index.js");
const OUTFILE = path.join(REPO_ROOT, "scripts", "antigravity-mcp-server.cjs");

function resolveEsbuildModule() {
  const candidates = [
    path.join(REPO_ROOT, "node_modules", "esbuild"),
    path.resolve(REPO_ROOT, "..", "PrivacyScrubber", "node_modules", "esbuild"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return require(p);
    }
  }
  return null;
}

const ROOT_EXTERNALS = new Map([
  ["./package.json", "../package.json"],
  ["./scrubber-core.cjs", "../scrubber-core.cjs"],
  ["./ps-license-manager.cjs", "../ps-license-manager.cjs"],
  ["./ps-license-manager.js", "../ps-license-manager.js"],
  ["./ps-pii-engine.cjs", "../ps-pii-engine.cjs"],
  ["./ps-pii-engine.js", "../ps-pii-engine.js"],
  ["./pii-masking-run.js", "../pii-masking-run.js"],
  ["./install.js", "../install.js"],
]);

const OPTIONAL_DOC_DEPS = ["mammoth", "pdf-parse", "xlsx"];

const BANNER_JS = [
  "#!/usr/bin/env node",
  'var __ps_fs = require("fs");',
  'var __ps_os = require("os");',
  'var __ps_path = require("path");',
  'var __ps_url = require("url");',
  'var __ps_root_meta_url = __ps_url.pathToFileURL(__ps_path.resolve(__dirname, "..", "index.js")).href;',
  "if (!process.env.PRIVACYSCRUBBER_KEY && !process.env.PRIVACYSCRUBBER_LICENSE_KEY && !process.env.ZTDS_LICENSE && !process.env.ZTDS_LICENSE_KEY) {",
  "  var __ps_candidates = [];",
  '  if (process.env.PLUGIN_DATA) __ps_candidates.push(__ps_path.join(process.env.PLUGIN_DATA, "license.key"));',
  '  __ps_candidates.push(__ps_path.join(__ps_os.homedir(), ".privacyscrubber", "license.key"));',
  "  for (var __i = 0; __i < __ps_candidates.length; __i++) {",
  "    try {",
  "      if (__ps_fs.existsSync(__ps_candidates[__i])) {",
  '        var __k = __ps_fs.readFileSync(__ps_candidates[__i], "utf8").trim();',
  "        if (__k) { process.env.PRIVACYSCRUBBER_KEY = __k; break; }",
  "      }",
  "    } catch (_e) {}",
  "  }",
  "}",
].join("\n");

function transformEntryForCjs(src) {
  let out = src.replace(/\r\n/g, "\n").replace(/^#!.*\n/, "");

  const declTarget =
    "const __filename = fileURLToPath(import.meta.url);\n" +
    "const __dirname = path.dirname(__filename);";
  if (!out.includes(declTarget)) {
    throw new Error("Expected __filename/__dirname declarations not found in index.js.");
  }
  out = out.replace(
    declTarget,
    "const __psModuleFile = fileURLToPath(import.meta.url);\nconst __psModuleDir = path.dirname(__psModuleFile);"
  );
  out = out
    .replaceAll("path.resolve(__dirname,", "path.resolve(__psModuleDir,")
    .replaceAll("chmodSync(__filename,", "chmodSync(__psModuleFile,");

  const cliTarget =
    "if (rawCliArgs.includes('--hook') || rawCliArgs.includes('--wrap')) {\n" +
    "  await import('./pii-masking-run.js');\n" +
    "  await new Promise(() => {});\n" +
    "}\n" +
    "if (rawCliArgs.some(arg => ['init', 'install', '--install', 'setup', '--setup', 'uninstall', '--uninstall', '--remove'].includes(arg))) {\n" +
    "  const { runInstaller } = await import('./install.js');\n" +
    "  const isRemove = rawCliArgs.some(arg => ['uninstall', '--uninstall', '--remove'].includes(arg));\n" +
    "  const forwardedArgs = rawCliArgs.filter(a => !['init', 'install', '--install', 'setup', '--setup', 'uninstall'].includes(a));\n" +
    "  if (isRemove && !forwardedArgs.includes('--remove') && !forwardedArgs.includes('--uninstall')) {\n" +
    "    forwardedArgs.push('--remove');\n" +
    "  }\n" +
    "  await runInstaller(forwardedArgs);\n" +
    "  process.exit(0);\n" +
    "}";
  if (!out.includes(cliTarget)) {
    throw new Error("Expected CLI dispatch block not found in index.js; update transformEntryForCjs.");
  }
  const cjsReplacement =
    "if (rawCliArgs.includes('--hook') || rawCliArgs.includes('--wrap')) {\n" +
    "  const r = require('child_process').spawnSync(process.execPath, [path.resolve(__psModuleDir, './pii-masking-run.js'), ...rawCliArgs], { stdio: 'inherit' });\n" +
    "  process.exit(r.status == null ? 1 : r.status);\n" +
    "}\n" +
    "if (rawCliArgs.some(arg => ['init', 'install', '--install', 'setup', '--setup', 'uninstall', '--uninstall', '--remove'].includes(arg))) {\n" +
    "  const r = require('child_process').spawnSync(process.execPath, [path.resolve(__psModuleDir, './install.js'), ...rawCliArgs], { stdio: 'inherit' });\n" +
    "  process.exit(r.status == null ? 1 : r.status);\n" +
    "}";
  return out.replace(cliTarget, cjsReplacement);
}

async function main() {
  const esbuild = resolveEsbuildModule();
  if (!esbuild) {
    throw new Error("esbuild package not found in node_modules or ../PrivacyScrubber/node_modules");
  }

  await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node18"],
    external: OPTIONAL_DOC_DEPS,
    define: {
      "import.meta.url": "__ps_root_meta_url",
    },
    banner: { js: BANNER_JS },
    plugins: [
      {
        name: "antigravity-cjs-adapter",
        setup(build) {
          build.onResolve({ filter: /^\.\// }, (args) => {
            if (path.resolve(args.resolveDir) !== REPO_ROOT) return null;
            const rewritten = ROOT_EXTERNALS.get(args.path);
            if (!rewritten) return null;
            return { path: rewritten, external: true };
          });
          build.onLoad({ filter: /\/index\.js$/ }, (args) => {
            if (path.resolve(args.path) !== ENTRY) return null;
            const src = fs.readFileSync(ENTRY, "utf8");
            return {
              contents: transformEntryForCjs(src),
              loader: "js",
              resolveDir: REPO_ROOT,
            };
          });
        },
      },
    ],
    logLevel: "warning",
  });

  fs.chmodSync(__filename, 0o755);
  fs.chmodSync(OUTFILE, 0o755);
  const sizeKb = Math.round(fs.statSync(OUTFILE).size / 1024);
  console.log(`[antigravity-bundle] Built ${path.relative(REPO_ROOT, OUTFILE)} (${sizeKb} KB, mode 0755)`);
}

main().catch((err) => {
  console.error("[antigravity-bundle] Build failed:", err);
  process.exit(1);
});
