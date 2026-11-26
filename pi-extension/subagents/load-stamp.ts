/**
 * weihung fork: the load stamp. Each load of this extension writes which
 * wrapper and which @nubl/maestro build the process runs under one branded
 * global, so a doctor (pi-straw-boss) can tell a stale or failed load from a
 * healthy one without importing either package. A load that throws writes
 * `failed` before the error leaves.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const LOAD_STAMP_KEY = Symbol.for("pi-herdr-agents/load-stamp");

export interface LoadStamp {
	readonly wrapperVersion?: string;
	readonly wrapperRoot: string;
	/** HEAD of the wrapper checkout, when it is one (a git install is). */
	readonly wrapperHead?: string;
	/** The `@nubl/maestro` dependency spec in the wrapper's package.json. */
	readonly maestroSpec?: string;
	readonly maestroVersion?: string;
	readonly maestroRoot?: string;
	/** Why maestro could not name its build, when it could not. */
	readonly maestroError?: string;
	readonly loadedAt: string;
	/** 1 for the first load in this process, raised by each later one. */
	readonly generation: number;
	/** The error message of a load that threw. */
	readonly failed?: string;
}

export interface StampSources {
	/** The wrapper package root. */
	readonly root: string;
	readonly maestro: () => { version: string; root: string };
}

type Slot = Record<symbol, LoadStamp | undefined>;

/** maestro's own answer, or why it gave none. */
interface MaestroRead {
	readonly version?: string;
	readonly root?: string;
	readonly error?: string;
}

/**
 * Runs a step of a load and stamps only when it throws: the module's own
 * creation, so a load that never reaches the factory still leaves `failed`.
 */
export function stampedOnFailure<T>(load: () => T, sources: StampSources): T {
	try {
		return load();
	} catch (error) {
		writeStamp(sources, error instanceof Error ? error.message : String(error));
		throw error;
	}
}

/** Runs one load and stamps it, whether it returns or throws. */
export function stampedLoad<T>(load: () => T, sources: StampSources): T {
	let failed: string | undefined;
	try {
		return load();
	} catch (error) {
		failed = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		writeStamp(sources, failed);
	}
}

function writeStamp(sources: StampSources, failed: string | undefined): void {
	// SAFETY: the branded key is written only here, always with a LoadStamp.
	const slot = globalThis as Slot;
	const pkg = readPackage(join(sources.root, "package.json"));
	let maestro: MaestroRead;
	try {
		maestro = sources.maestro();
	} catch (error) {
		maestro = { error: error instanceof Error ? error.message : String(error) };
	}
	slot[LOAD_STAMP_KEY] = Object.freeze({
		wrapperVersion: pkg?.version,
		wrapperRoot: sources.root,
		wrapperHead: readGitHead(sources.root),
		maestroSpec: pkg?.dependencies?.["@nubl/maestro"],
		maestroVersion: maestro.version,
		maestroRoot: maestro.root,
		maestroError: maestro.error,
		loadedAt: new Date().toISOString(),
		generation: (slot[LOAD_STAMP_KEY]?.generation ?? 0) + 1,
		failed,
	});
}

interface Manifest {
	version?: string;
	dependencies?: Record<string, string>;
}

function readPackage(file: string): Manifest | undefined {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function readText(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8").trim();
	} catch {
		return undefined;
	}
}

/**
 * The commit `dir`'s checkout has checked out, read from the files git keeps
 * (no git process at load): `.git` as a directory or a worktree's gitdir file,
 * then HEAD, a loose ref or packed-refs.
 */
export function readGitHead(dir: string): string | undefined {
	const dotGit = join(dir, ".git");
	const pointer = readText(dotGit);
	let gitDir = dotGit;
	if (pointer?.startsWith("gitdir: ")) {
		const target = pointer.slice("gitdir: ".length);
		gitDir = isAbsolute(target) ? target : resolve(dir, target);
	}
	const head = readText(join(gitDir, "HEAD"));
	if (!head) return undefined;
	if (!head.startsWith("ref: ")) return head;
	const ref = head.slice("ref: ".length);
	const common = readText(join(gitDir, "commondir"));
	const shared = common ? resolve(gitDir, common) : gitDir;
	for (const base of [gitDir, shared]) {
		const loose = readText(join(base, ref));
		if (loose) return loose;
	}
	const packed = readText(join(shared, "packed-refs"));
	const line = packed?.split("\n").find((entry) => entry.endsWith(` ${ref}`));
	return line?.split(" ")[0];
}
