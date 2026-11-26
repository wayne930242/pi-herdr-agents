/**
 * weihung fork: one native module graph per @nubl/maestro build.
 *
 * Pi's `/reload` re-imports this package through jiti with `moduleCache:
 * false`, which re-reads its TypeScript. `@nubl/maestro` ships compiled ESM
 * (`"type": "module"`), and jiti hands async imports of such files to Node's
 * native `import()`, whose registry keeps each module for the life of the
 * process. After the install moves in place, a reload would run the new
 * wrapper against the maestro modules the process loaded first, and a module
 * that reads a new export finds it missing: the move from 189b091 to 944046d
 * failed with "Cannot read properties of undefined (reading 'source')" in
 * maestro's catalog.js, so the package registered no tools.
 *
 * Each load records which maestro build it brings. When that differs from the
 * build this process loaded before, a resolve hook appends
 * `?engine-build=<tag>` to every file URL under the maestro package root, so
 * Node evaluates the new build from disk. The first load in a process and a
 * reload of the same build keep the modules already loaded.
 *
 * Every entry Pi loads imports this module before any maestro module. Pi
 * transpiles those entries, so their imports run in source order.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LOAD_STAMP_KEY } from "./load-stamp.ts";

export const ENGINE_BUILD_KEY: unique symbol = Symbol.for(
	"pi-herdr-agents/engine-build",
);
/** Written by maestro's createPiExtension at every load of this package. */
const SUBAGENT_RUNTIME_KEY = Symbol.for("pi-subagents/runtime");
const QUERY = "engine-build";

export interface EngineBuildSources {
	/** The wrapper package root. */
	readonly wrapperRoot: string;
	/** The @nubl/maestro package root Node resolves from the wrapper. */
	readonly maestroRoot: string;
}

export interface EngineBuildState {
	/** The maestro build this load brought. */
	readonly key: string;
	/** The query tag maestro URLs carry; none while the process's first build runs. */
	readonly tag?: string;
	/** This load's resolve hook, deregistered by the next load. */
	readonly hooks?: nodeModule.ModuleHooks;
}

export interface EngineBuildSlots {
	[ENGINE_BUILD_KEY]?: EngineBuildState;
}

type RegisterHooks = typeof nodeModule.registerHooks;

interface Manifest {
	version?: string;
	dependencies?: Record<string, string>;
}

interface LockEntry {
	resolved?: string;
	integrity?: string;
}

interface HiddenLockfile {
	packages?: Record<string, LockEntry>;
}

function readJson<T>(file: string): T | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Names the installed maestro build: npm's hidden lockfile entry (resolved
 * commit and integrity) when there is one, else the wrapper's dependency spec
 * with maestro's version, which other package managers leave readable.
 */
export function engineBuildKey(sources: EngineBuildSources): string {
	const lock = readJson<HiddenLockfile>(
		join(sources.maestroRoot, "..", "..", ".package-lock.json"),
	);
	const entry = lock?.packages?.["node_modules/@nubl/maestro"];
	if (entry?.resolved || entry?.integrity)
		return `lock ${entry.resolved ?? ""} ${entry.integrity ?? ""}`;
	const spec = readJson<Manifest>(join(sources.wrapperRoot, "package.json"))
		?.dependencies?.["@nubl/maestro"];
	const version = readJson<Manifest>(
		join(sources.maestroRoot, "package.json"),
	)?.version;
	return `spec ${spec ?? ""} ${version ?? ""}`;
}

/**
 * The tag this load's maestro URLs carry. The same build keeps the previous
 * tag (none for the process's first build); another build gets its own. With
 * no recorded build, a runtime or load stamp left by a build from before this
 * module means the process already holds an unknown maestro graph.
 */
export function nextEngineTag(
	previous: EngineBuildState | undefined,
	key: string,
	loadedBefore: boolean,
): string | undefined {
	if (previous) return previous.key === key ? previous.tag : engineTag(key);
	return loadedBefore ? engineTag(key) : undefined;
}

function engineTag(key: string): string {
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** `url` with this build's tag when it names a file under the maestro root. */
export function engineBuildUrl(
	url: string,
	prefix: string,
	tag: string,
): string {
	if (!url.startsWith(prefix) || url.includes("?") || url.includes("#"))
		return url;
	return `${url}?${QUERY}=${tag}`;
}

/**
 * Records this load's maestro build and, when the process already holds
 * another, registers the resolve hook that loads this one fresh. Replaces the
 * previous load's hook, so only the current module's code tags URLs.
 */
export function prepareEngineBuild(
	sources: EngineBuildSources,
	slots: EngineBuildSlots,
	/** `node:module` registerHooks, which Node.js before 22.15 lacks. */
	register: RegisterHooks | undefined,
): EngineBuildState {
	const key = engineBuildKey(sources);
	const previous = slots[ENGINE_BUILD_KEY];
	const loadedBefore = SUBAGENT_RUNTIME_KEY in slots || LOAD_STAMP_KEY in slots;
	const tag = nextEngineTag(previous, key, loadedBefore);
	if (tag !== undefined && !register)
		throw new Error(
			"pi-herdr-agents: this Pi process already loaded another @nubl/maestro build, and loading the installed one needs node:module registerHooks (Node.js 22.15 or later). Restart Pi.",
		);
	previous?.hooks?.deregister();
	let hooks: nodeModule.ModuleHooks | undefined;
	if (tag !== undefined && register) {
		// Node resolves symlinks before it names a module's URL.
		const prefix = `${pathToFileURL(realpathSync(sources.maestroRoot)).href}/`;
		hooks = register({
			resolve(specifier, context, nextResolve) {
				const resolved = nextResolve(specifier, context);
				const url = engineBuildUrl(resolved.url, prefix, tag);
				return url === resolved.url ? resolved : { ...resolved, url };
			},
		});
	}
	const state: EngineBuildState = Object.freeze({ key, tag, hooks });
	slots[ENGINE_BUILD_KEY] = state;
	return state;
}

prepareEngineBuild(
	{
		wrapperRoot: fileURLToPath(new URL("../../", import.meta.url)),
		maestroRoot: dirname(
			nodeModule
				.createRequire(import.meta.url)
				.resolve("@nubl/maestro/package.json"),
		),
	},
	// SAFETY: only this module writes ENGINE_BUILD_KEY, always an EngineBuildState.
	globalThis as EngineBuildSlots,
	nodeModule.registerHooks,
);
