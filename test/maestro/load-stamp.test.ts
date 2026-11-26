import "../clean-host-env.ts";
import "../isolated-agent-dir.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";
import {
	LOAD_STAMP_KEY,
	type LoadStamp,
	readGitHead,
	stampedLoad,
	stampedOnFailure,
} from "../../pi-extension/subagents/load-stamp.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)).replace(
	/\/$/,
	"",
);
// SAFETY: only the load stamp writes this key, always with a LoadStamp.
const slot = globalThis as Record<symbol, LoadStamp | undefined>;
const current = (): LoadStamp | undefined => slot[LOAD_STAMP_KEY];
const maestro = () => ({ version: "9.9.9", root: "/m" });

afterEach(() => {
	delete slot[LOAD_STAMP_KEY];
});

describe("load stamp", () => {
	it("a load writes the stamp under the branded global key", () => {
		const result = stampedLoad(() => 42, { root, maestro });
		assert.equal(result, 42);
		const stamp = slot[Symbol.for("pi-herdr-agents/load-stamp")];
		assert.ok(stamp);
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		assert.equal(stamp.wrapperVersion, pkg.version);
		assert.equal(stamp.wrapperRoot, root);
		assert.equal(stamp.maestroVersion, "9.9.9");
		assert.equal(stamp.maestroRoot, "/m");
		assert.equal(stamp.maestroSpec, pkg.dependencies["@nubl/maestro"]);
		assert.equal(stamp.generation, 1);
		assert.equal(stamp.failed, undefined);
		assert.ok(!Number.isNaN(Date.parse(stamp.loadedAt)));
	});

	it("a factory that throws writes failed and rethrows", () => {
		assert.throws(
			() =>
				stampedLoad(
					() => {
						throw new Error("slot owned by an older build");
					},
					{ root, maestro },
				),
			/slot owned by an older build/,
		);
		assert.equal(slot[LOAD_STAMP_KEY]?.failed, "slot owned by an older build");
	});

	it("a creation step stamps only when it throws", () => {
		assert.equal(
			stampedOnFailure(() => 1, { root, maestro }),
			1,
		);
		assert.equal(slot[LOAD_STAMP_KEY], undefined);
		assert.throws(() =>
			stampedOnFailure(
				() => {
					throw new Error("bad module");
				},
				{ root, maestro },
			),
		);
		assert.equal(current()?.failed, "bad module");
	});

	it("the entry's factory stamps each load", async () => {
		const entry = await import("../../pi-extension/subagents/index.ts");
		assert.equal(slot[LOAD_STAMP_KEY], undefined);
		const { api, registeredTools } = createMockExtensionApi();
		entry.default(api);
		assert.ok(registeredTools.some((tool) => tool.name === "subagent"));
		const stamp = current();
		assert.equal(stamp?.wrapperRoot, root);
		assert.equal(stamp?.maestroRoot, join(root, "node_modules/@nubl/maestro"));
		assert.equal(stamp?.generation, 1);
		assert.equal(stamp?.failed, undefined);
	});

	it("a maestro that cannot name its build still stamps, with the reason", () => {
		stampedLoad(() => undefined, {
			root,
			maestro: () => {
				throw new Error("no package.json");
			},
		});
		const stamp = slot[LOAD_STAMP_KEY];
		assert.equal(stamp?.maestroVersion, undefined);
		assert.equal(stamp?.maestroError, "no package.json");
	});

	it("a second load overwrites the stamp and raises the generation", () => {
		stampedLoad(() => undefined, { root, maestro });
		const first = slot[LOAD_STAMP_KEY];
		stampedLoad(() => undefined, { root, maestro });
		assert.notEqual(slot[LOAD_STAMP_KEY], first);
		assert.equal(slot[LOAD_STAMP_KEY]?.generation, 2);
	});
});

describe("readGitHead", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
	});
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

	it("reads a branch head, a detached head and a worktree's gitdir file", () => {
		const repo = mkdtempSync(join(tmpdir(), "stamp-repo-"));
		dirs.push(repo);
		git(repo, "init", "-q", "-b", "main");
		writeFileSync(join(repo, "a"), "a");
		git(repo, "add", "a");
		git(
			repo,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@t",
			"commit",
			"-qm",
			"a",
		);
		const head = git(repo, "rev-parse", "HEAD");
		assert.equal(readGitHead(repo), head);
		git(repo, "pack-refs", "--all");
		assert.equal(readGitHead(repo), head);
		const tree = join(repo, "wt");
		git(repo, "worktree", "add", "-q", "--detach", tree);
		assert.equal(readGitHead(tree), head);
	});

	it("is undefined outside a checkout", () => {
		const dir = mkdtempSync(join(tmpdir(), "stamp-none-"));
		dirs.push(dir);
		assert.equal(readGitHead(dir), undefined);
	});
});
