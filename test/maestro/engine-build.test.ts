import "../clean-host-env.ts";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import {
	ENGINE_BUILD_KEY,
	type EngineBuildSlots,
	type EngineBuildSources,
	engineBuildKey,
	engineBuildUrl,
	nextEngineTag,
	prepareEngineBuild,
} from "../../pi-extension/subagents/engine-build.ts";

const dirs: string[] = [];
const slotsInUse: EngineBuildSlots[] = [];

afterEach(() => {
	for (const slots of slotsInUse.splice(0))
		slots[ENGINE_BUILD_KEY]?.hooks?.deregister();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

function newSlots(): EngineBuildSlots {
	const slots: EngineBuildSlots = {};
	slotsInUse.push(slots);
	return slots;
}

/** A wrapper install with an ESM maestro whose b.js exports `value`. */
function install(commit: string, value: string): EngineBuildSources {
	// Node names modules by real path; macOS temp directories are symlinked.
	const wrapperRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "engine-build-")),
	);
	dirs.push(wrapperRoot);
	const maestroRoot = join(wrapperRoot, "node_modules", "@nubl", "maestro");
	mkdirSync(join(maestroRoot, "dist"), { recursive: true });
	writeFileSync(
		join(maestroRoot, "package.json"),
		JSON.stringify({ name: "@nubl/maestro", version: "0.1.2", type: "module" }),
	);
	writeFileSync(
		join(maestroRoot, "dist", "a.js"),
		'export { value } from "./b.js";\n',
	);
	writeFileSync(
		join(wrapperRoot, "package.json"),
		JSON.stringify({
			dependencies: { "@nubl/maestro": `git+https://x/maestro.git#${commit}` },
		}),
	);
	const sources = { wrapperRoot, maestroRoot };
	update(sources, commit, value);
	return sources;
}

/** Moves the install in place to another maestro commit, as an update does. */
function update(sources: EngineBuildSources, commit: string, value: string) {
	writeFileSync(
		join(sources.maestroRoot, "dist", "b.js"),
		`export const value = ${JSON.stringify(value)};\n`,
	);
	writeFileSync(
		join(sources.wrapperRoot, "node_modules", ".package-lock.json"),
		JSON.stringify({
			packages: {
				"node_modules/@nubl/maestro": {
					resolved: `git+ssh://x/maestro.git#${commit}`,
					integrity: `sha512-${commit}`,
				},
			},
		}),
	);
}

async function importValue(sources: EngineBuildSources): Promise<string> {
	const url = pathToFileURL(join(sources.maestroRoot, "dist", "a.js")).href;
	const loaded: { value: string } = await import(url);
	return loaded.value;
}

describe("engine build", () => {
	it("a reload into another maestro build evaluates that build, not the cached one", async () => {
		const sources = install("aaa", "v1");
		const slots = newSlots();
		const first = prepareEngineBuild(sources, slots, registerHooks);
		assert.equal(first.tag, undefined);
		assert.equal(first.hooks, undefined);
		assert.equal(await importValue(sources), "v1");

		update(sources, "bbb", "v2");
		// The defect: Node's registry still returns the first build.
		assert.equal(await importValue(sources), "v1");

		const second = prepareEngineBuild(sources, slots, registerHooks);
		assert.ok(second.tag);
		assert.ok(second.hooks);
		assert.equal(await importValue(sources), "v2");
	});

	it("a reload of the same build keeps the modules already loaded", async () => {
		const sources = install("aaa", "v1");
		const slots = newSlots();
		prepareEngineBuild(sources, slots, registerHooks);
		const url = pathToFileURL(join(sources.maestroRoot, "dist", "a.js")).href;
		const before = await import(url);
		const again = prepareEngineBuild(sources, slots, registerHooks);
		assert.equal(again.tag, undefined);
		assert.equal(again.hooks, undefined);
		assert.equal(await import(url), before);

		update(sources, "bbb", "v2");
		const moved = prepareEngineBuild(sources, slots, registerHooks);
		const fresh = await import(url);
		assert.equal(fresh.value, "v2");
		const same = prepareEngineBuild(sources, slots, registerHooks);
		assert.equal(same.tag, moved.tag);
		assert.equal(await import(url), fresh);
	});

	it("a process that ran a build from before this module loads the installed build fresh", async () => {
		const sources = install("aaa", "v1");
		assert.equal(await importValue(sources), "v1");
		update(sources, "bbb", "v2");
		const slots = newSlots();
		Object.defineProperty(slots, Symbol.for("pi-subagents/runtime"), {
			value: { runningSubagents: new Map() },
		});
		const state = prepareEngineBuild(sources, slots, registerHooks);
		assert.ok(state.tag);
		assert.equal(await importValue(sources), "v2");
	});

	it("each load replaces the previous load's hook", () => {
		const sources = install("aaa", "v1");
		const slots = newSlots();
		let registered = 0;
		let deregistered = 0;
		const register = () => {
			registered++;
			return {
				deregister() {
					deregistered++;
				},
			};
		};
		prepareEngineBuild(sources, slots, register);
		assert.equal(registered, 0);
		update(sources, "bbb", "v2");
		prepareEngineBuild(sources, slots, register);
		prepareEngineBuild(sources, slots, register);
		assert.equal(registered, 2);
		assert.equal(deregistered, 1);
	});

	it("without registerHooks a build change fails with a restart hint and keeps the old hook", () => {
		const sources = install("aaa", "v1");
		const slots = newSlots();
		prepareEngineBuild(sources, slots, registerHooks);
		update(sources, "bbb", "v2");
		const before = prepareEngineBuild(sources, slots, registerHooks);
		update(sources, "ccc", "v3");
		assert.throws(
			() => prepareEngineBuild(sources, slots, undefined),
			/registerHooks .*Restart Pi/,
		);
		assert.equal(slots[ENGINE_BUILD_KEY], before);
	});
});

describe("engine build parts", () => {
	it("the key follows npm's hidden lockfile, else the dependency spec and version", () => {
		const sources = install("aaa", "v1");
		const locked = engineBuildKey(sources);
		assert.match(locked, /#aaa sha512-aaa$/);
		update(sources, "bbb", "v1");
		assert.notEqual(engineBuildKey(sources), locked);
		rmSync(join(sources.wrapperRoot, "node_modules", ".package-lock.json"));
		assert.equal(
			engineBuildKey(sources),
			"spec git+https://x/maestro.git#aaa 0.1.2",
		);
	});

	it("the same build keeps its tag, another build gets its own", () => {
		assert.equal(nextEngineTag(undefined, "a", false), undefined);
		const unknown = nextEngineTag(undefined, "a", true);
		assert.match(unknown ?? "", /^[0-9a-f]{16}$/);
		assert.equal(nextEngineTag({ key: "a" }, "a", true), undefined);
		assert.equal(nextEngineTag({ key: "a", tag: "t" }, "a", true), "t");
		const moved = nextEngineTag({ key: "a" }, "b", false);
		assert.ok(moved);
		assert.notEqual(moved, nextEngineTag({ key: "a" }, "c", false));
		assert.equal(nextEngineTag({ key: "b", tag: "t" }, "a", false), unknown);
	});

	it("tags only plain file URLs under the maestro root", () => {
		const prefix = "file:///w/node_modules/@nubl/maestro/";
		assert.equal(
			engineBuildUrl(`${prefix}dist/a.js`, prefix, "t"),
			`${prefix}dist/a.js?engine-build=t`,
		);
		for (const url of [
			"file:///w/node_modules/@nubl/maestro-other/a.js",
			"file:///w/pi-extension/subagents/index.ts",
			"node:fs",
			`${prefix}dist/a.js?engine-build=old`,
		])
			assert.equal(engineBuildUrl(url, prefix, "t"), url);
	});
});
