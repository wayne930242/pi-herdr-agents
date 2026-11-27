// weihung fork: first, so a reload into another maestro build loads it fresh.
import "./engine-build.ts";
import { fileURLToPath } from "node:url";
import { createPiExtension, maestroBuildInfo } from "@nubl/maestro/pi";
import { hostSurfaceBinding } from "./host-surface.ts";
import { borderLine, createWidgetController } from "./widgets.ts";
import { RunRows } from "./run-rows.ts";
import { registerMessageRenderers } from "./renderers.ts";
import { toolRenderers } from "./tool-renderers.ts";
import {
	stampedLoad,
	stampedOnFailure,
	type StampSources,
} from "./load-stamp.ts";

export {
	hasWorkingSubagents,
	shouldDeliverSubagentCompletion,
	selectCompletionApi,
	shouldPreserveSubagentsOnShutdown,
	cleanupSubagentsForShutdown,
	shouldAdvanceToFallback,
} from "@nubl/maestro/pi/subagents/index";

const stampSources: StampSources = {
	root: fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, ""),
	maestro: maestroBuildInfo,
};

// Invoke per load, not in the engine cache. Presentation never replaces a run owner.
// weihung fork: each factory call stamps the load; a creation that throws does too.
const presenters = new WeakMap<
	Parameters<typeof registerMessageRenderers>[0],
	RunRows
>();
let registerRows: (pi: Parameters<typeof registerMessageRenderers>[0]) => void;
const extension = stampedOnFailure(
	() =>
		createPiExtension({
			hostSurface: hostSurfaceBinding,
			presentation: {
				borderLine,
				createWidgets: (deps) => {
					registerRows = (pi) => {
						const rows = new RunRows();
						presenters.set(pi, rows);
						rows.register(pi, deps.runtime.runningSubagents);
					};
					return createWidgetController(deps, presenters);
				},
				registerMessageRenderers,
				toolRenderers,
			},
			childEntryPath: fileURLToPath(
				new URL(
					"../../maestro/adapters/pi/child/subagent-done.ts",
					import.meta.url,
				),
			),
			configAssetRoot: fileURLToPath(new URL("../../", import.meta.url)),
		}),
	stampSources,
);

export const __test__ = extension.__test__;
export default function piHerdrAgents(
	...args: Parameters<typeof extension>
): ReturnType<typeof extension> {
	return stampedLoad(() => {
		const result = extension(...args);
		registerRows(args[0]);
		return result;
	}, stampSources);
}
