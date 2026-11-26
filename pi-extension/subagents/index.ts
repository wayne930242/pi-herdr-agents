import { fileURLToPath } from "node:url";
import { createPiExtension, maestroBuildInfo } from "@nubl/maestro/pi";
import { hostSurfaceBinding } from "./host-surface.ts";
import { borderLine, createWidgetController } from "./widgets.ts";
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
const extension = stampedOnFailure(
	() =>
		createPiExtension({
			hostSurface: hostSurfaceBinding,
			presentation: {
				borderLine,
				createWidgets: createWidgetController,
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
	return stampedLoad(() => extension(...args), stampSources);
}
