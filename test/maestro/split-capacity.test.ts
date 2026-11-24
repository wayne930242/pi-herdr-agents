import "../clean-host-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { __herdrTest__ } from "../../maestro/surfaces/herdr/herdr.ts";
import { canSplitParent } from "../../maestro/surfaces/herdr/split-capacity.ts";

test("the right-split cutoff counts usable columns, not rows or borders", async () => {
	for (const [width, expected] of [
		[163, false],
		[164, true],
	] as const) {
		await __herdrTest__.withMockHerdrExec(
			() =>
				JSON.stringify({
					result: {
						type: "pane_layout",
						layout: {
							zoomed: false,
							panes: [{ pane_id: "parent", rect: { width, height: 24 } }],
						},
					},
				}),
			async () => {
				assert.equal(
					await canSplitParent("parent", "right", 80, 1000),
					expected,
				);
			},
		);
	}
});
