import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { it } from "node:test";
import { createLifecycle } from "@nubl/maestro/core/lifecycle";
import host, { __test__ } from "../../pi-extension/subagents/index.ts";
import { createMockExtensionApi } from "../helpers/mock-extension-api.ts";

interface Probe {
	claim?: { by: string; ids: string[] };
	rows?: unknown;
}

it("publishes detached live rows; only fresh claims hide widget rows", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1000 });
	const { api } = createMockExtensionApi();
	host(api);
	const probe = (claim?: { by: string; ids: string[] }) => {
		const p: Probe = { claim };
		api.events.emit("pi-herdr-agents:run-rows:v1", p);
		return p.rows;
	};
	assert.deepEqual(probe(), { version: 1, rows: [] });
	const runs = ["Alpha", "Bravo"].map((name) => ({
		id: name,
		name,
		task: "",
		surface: "s1",
		startTime: 1000,
		sessionFile: "unused",
		interactive: false,
		lifecycle: createLifecycle(1000),
		runtimePlan: undefined,
	}));
	for (const r of runs) __test__.runningSubagents.set(r.id, r);
	t.after(() => __test__.runningSubagents.clear());
	const draw = () => __test__.renderSubagentWidgetLines(runs, 100);
	const original = draw();
	const rows = runs.map(({ id, name }) => ({
		id,
		name,
		startedAt: 1000,
		phase: { kind: "starting" },
	}));
	assert.deepEqual(probe({ by: "ledger", ids: ["Alpha"] }), {
		version: 1,
		rows,
	});
	assert.match(draw().join("\n"), /1 active · 1 on todos/);
	assert.doesNotMatch(draw().join("\n"), /Alpha/);
	assert.match(draw()[1], /Bravo/);
	probe({ by: "other", ids: ["Bravo"] });
	assert.deepEqual(draw(), []);
	probe({ by: "ledger", ids: [] });
	assert.match(draw()[1], /Alpha/);
	t.mock.timers.tick(3000);
	const expired = draw();
	probe({ by: "other", ids: [] });
	assert.deepEqual(expired, draw());
	assert.equal(expired.length, original.length);
	assert.match(expired[0], /2 active/);
});
