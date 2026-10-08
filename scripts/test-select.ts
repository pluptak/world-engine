// Runs the tests a change can affect, by what each test file executed when the map was built.
//
//   map               run the whole suite under V8 coverage and write .test-map.json: for each test
//                     file, the project .ts files whose functions it ran (child processes included)
//   run [--typecheck] [--list] [--base <ref>] [--paths a,b]
//                     select from the files changed since the map's commit (committed, staged,
//                     unstaged and untracked) and run them; --list only prints the selection
//
// A test file is selected when it changed, when it ran a function of a changed .ts file, when it
// names a changed data file by path (`scenarios/inn.json`, `docs/verbs.md`), or when a
// `// test-select: reads <glob>` line in it matches a changed file. Templates, package and config
// changes, or no map, run everything. Files nothing reads (plans, the backlog, most docs) run nothing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const mapPath = join(root, ".test-map.json");
const testsDir = join(root, "tests");

interface TestMap {
  base: string;
  tests: Record<string, string[]>;
}

// Changes that can reach every test, or that the map cannot see into.
const RUN_ALL = [/^templates\//, /^package(-lock)?\.json$/, /^tsconfig\.json$/, /^scripts\/test-select\.ts$/];

function posix(path: string): string {
  return path.split(sep).join("/");
}

function git(args: string[]): string {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  }
  return run.stdout;
}

function testFiles(): string[] {
  return readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.ts"))
    .sort()
    .map((name) => `tests/${name}`);
}

function runTests(files: readonly string[], env: NodeJS.ProcessEnv = process.env): number {
  if (files.length === 0) {
    return 0;
  }
  const run = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: root, stdio: "inherit", env });
  return run.status ?? 1;
}

type Functions = ReadonlyArray<{ functionName: string; ranges: ReadonlyArray<{ startOffset: number; count: number }> }>;
interface Report {
  result: Array<{ url: string; functions: Functions }>;
}

// The project .ts file a coverage entry is, relative to the root, or null for anything else.
function projectFile(url: string): string | null {
  if (!url.startsWith("file:")) {
    return null;
  }
  const file = posix(relative(root, fileURLToPath(url)));
  return file.startsWith("..") || file.startsWith("node_modules/") || !file.endsWith(".ts") ? null : file;
}

function reports(dir: string): Report[] {
  return readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as Report);
}

// How often each function runs when every src module is merely loaded: a verb built by a factory
// at load, say. A test uses a module only by running one of its functions more often than that.
function loadBaseline(): Map<string, number> {
  const coverage = mkdtempSync(join(tmpdir(), "world-engine-baseline-"));
  try {
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) {
          walk(path);
        } else if (name.name.endsWith(".ts")) {
          sources.push(path);
        }
      }
    };
    walk(join(root, "src"));
    const imports = sources.map((path) => `await import(${JSON.stringify(new URL(`file:///${posix(path)}`).href)});`).join("\n");
    spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", imports], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_V8_COVERAGE: coverage },
    });
    const counts = new Map<string, number>();
    for (const report of reports(coverage)) {
      for (const script of report.result) {
        const file = projectFile(script.url);
        for (const fn of file === null ? [] : script.functions) {
          counts.set(`${file}@${fn.ranges[0]?.startOffset}`, fn.ranges[0]?.count ?? 0);
        }
      }
    }
    return counts;
  } finally {
    rmSync(coverage, { recursive: true, force: true });
  }
}

// Whether a run used a module: ran a function of it, other than its body and esbuild's `__name`
// helper, more often than loading it does. A module with no function of its own is data, so
// loading it is using it.
function used(file: string, functions: Functions, baseline: ReadonlyMap<string, number>): boolean {
  if (functions.length <= 1) {
    return true;
  }
  return functions.some((fn, index) => {
    const isBody = index === 0 && fn.functionName === "" && fn.ranges[0]?.startOffset === 0;
    const count = fn.ranges[0]?.count ?? 0;
    return !isBody && fn.functionName !== "__name" && count > (baseline.get(`${file}@${fn.ranges[0]?.startOffset}`) ?? 0);
  });
}

function buildMap(): number {
  const baseline = loadBaseline();
  const coverage = mkdtempSync(join(tmpdir(), "world-engine-coverage-"));
  try {
    const status = runTests(testFiles(), { ...process.env, NODE_V8_COVERAGE: coverage });
    const tests: Record<string, Set<string>> = Object.fromEntries(testFiles().map((file) => [file, new Set<string>()]));
    // A process with no test file in it was spawned by a test (the CLI, a lock holder): what it ran
    // belongs to every test that starts processes.
    const spawned = new Set<string>();
    for (const report of reports(coverage)) {
      const ran = new Set<string>();
      let owner: string | undefined;
      for (const script of report.result) {
        const file = projectFile(script.url);
        if (file === null) {
          continue;
        }
        if (/^tests\/[^/]+\.test\.ts$/.test(file)) {
          owner = file;
        }
        if (used(file, script.functions, baseline)) {
          ran.add(file);
        }
      }
      if (owner !== undefined && tests[owner] !== undefined) {
        ran.forEach((file) => tests[owner]!.add(file));
      } else if (owner === undefined) {
        ran.forEach((file) => spawned.add(file));
      }
    }
    for (const file of Object.keys(tests)) {
      if (/\bspawnSync\(|\bspawn\(|\bfork\(|\bcliProcess\(/.test(readFileSync(join(root, file), "utf8"))) {
        spawned.forEach((used) => tests[file]!.add(used));
      }
    }
    const map: TestMap = {
      base: git(["rev-parse", "HEAD"]).trim(),
      tests: Object.fromEntries(Object.entries(tests).map(([file, used]) => [file, [...used].sort()])),
    };
    writeFileSync(mapPath, `${JSON.stringify(map, null, 1)}\n`);
    console.log(`test-select: map of ${Object.keys(map.tests).length} test files written at ${map.base.slice(0, 7)}`);
    return status;
  } finally {
    rmSync(coverage, { recursive: true, force: true });
  }
}

function changedSince(base: string): string[] {
  const tracked = git(["diff", "--name-only", base]).split("\n");
  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n");
  return [...new Set([...tracked, ...untracked].map((line) => line.trim()).filter((line) => line.length > 0))].sort();
}

function globRegExp(glob: string): RegExp {
  const pattern = glob
    .split("**")
    .map((part) => part.split("*").map((piece) => piece.replace(/[.+^${}()|[\]\\?]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

// What a test file reads that coverage cannot see: the data paths it names, and its declared reads.
function reads(file: string): { paths: string[]; globs: RegExp[] } {
  const text = readFileSync(join(root, file), "utf8");
  const paths = [...text.matchAll(/\b((?:scenarios|docs)\/[A-Za-z0-9_.\/-]+\.(?:json|md))/g)].map((match) => match[1]!);
  const globs = [...text.matchAll(/^\/\/ test-select: reads (\S+)/gm)].map((match) => globRegExp(match[1]!));
  return { paths, globs };
}

function select(changed: readonly string[], map: TestMap | null): { files: string[]; reasons: Map<string, string> } {
  const all = testFiles();
  const reasons = new Map<string, string>();
  const everything = (why: string) => {
    for (const file of all) {
      reasons.set(file, why);
    }
  };
  if (map === null) {
    everything("no .test-map.json (npm run test:map)");
  }
  for (const path of changed) {
    if (RUN_ALL.some((pattern) => pattern.test(path))) {
      everything(path);
      continue;
    }
    for (const file of all) {
      if (reasons.has(file)) {
        continue;
      }
      const used = map?.tests[file];
      const { paths, globs } = reads(file);
      if (
        file === path ||
        // A test file the map has never seen runs, whatever changed.
        used === undefined ||
        used.includes(path) ||
        paths.includes(path) ||
        globs.some((glob) => glob.test(path))
      ) {
        reasons.set(file, used === undefined && file !== path ? "not in the map" : path);
      }
    }
  }
  return { files: all.filter((file) => reasons.has(file)), reasons };
}

function readMap(): TestMap | null {
  if (!existsSync(mapPath)) {
    return null;
  }
  return JSON.parse(readFileSync(mapPath, "utf8")) as TestMap;
}

function runChanged(argv: readonly string[]): number {
  const map = readMap();
  const baseFlag = argv.indexOf("--base");
  const base = baseFlag >= 0 ? argv[baseFlag + 1]! : (map?.base ?? "HEAD");
  // `--paths a,b` asks what a change to those files would run, instead of reading git.
  const pathsFlag = argv.indexOf("--paths");
  const changed = pathsFlag >= 0 ? argv[pathsFlag + 1]!.split(",") : changedSince(base);
  const { files, reasons } = select(changed, map);
  console.log(`test-select: ${changed.length} changed since ${base.slice(0, 7)}, ${files.length} of ${testFiles().length} test files`);
  for (const file of files) {
    console.log(`  ${file}  (${reasons.get(file)})`);
  }
  if (argv.includes("--list")) {
    return 0;
  }
  if (argv.includes("--typecheck") && changed.some((path) => path.endsWith(".ts") || RUN_ALL.some((pattern) => pattern.test(path)))) {
    const typecheck = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit"], { cwd: root, stdio: "inherit" });
    if (typecheck.status !== 0) {
      return typecheck.status ?? 1;
    }
  }
  return runTests(files);
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "map") {
  process.exitCode = buildMap();
} else if (mode === "run") {
  process.exitCode = runChanged(rest);
} else {
  console.error("usage: test-select map | run [--typecheck] [--list] [--base <ref>]");
  process.exitCode = 2;
}
