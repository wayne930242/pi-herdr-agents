import {
	isFiniteNumber,
	isRecord,
} from "@nubl/maestro/core/config/type-guards";
import { herdrExecAsync, parseHerdrJson } from "./herdr-cli.ts";

/** Layout rectangles include the one-cell border on each edge. Herdr's
 * default split is 50:50; round down rather than depending on which half
 * receives an odd cell. A zoomed rectangle is not the unzoomed split area. */
export async function canSplitParent(
	parent: string,
	direction: "right" | "down",
	minimum: number,
	timeout: number,
): Promise<boolean> {
	try {
		const result = parseHerdrJson(
			await herdrExecAsync(["pane", "layout", "--pane", parent], timeout),
		)?.result;
		const layout = result?.layout;
		if (
			result?.type !== "pane_layout" ||
			layout?.zoomed !== false ||
			!Array.isArray(layout.panes)
		)
			return false;
		const panes: unknown[] = layout.panes;
		const pane = panes.find(
			(item) => isRecord(item) && item.pane_id === parent,
		);
		if (!isRecord(pane) || !isRecord(pane.rect)) return false;
		const rect = pane.rect;
		const cells = direction === "right" ? rect?.width : rect?.height;
		return (
			isFiniteNumber(cells) &&
			Number.isSafeInteger(cells) &&
			Math.floor(cells / 2) - 2 >= minimum
		);
	} catch {
		// No mutation was attempted. Unknown geometry selects grouped placement.
		return false;
	}
}
