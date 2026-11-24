import type { Deadline } from "@nubl/maestro/core/deadline";

const placementKey = Symbol.for("pi-herdr-subagents:placement-queue");
// SAFETY: only this module owns this reload-surviving queue and retention set.
const queueGlobal = globalThis as typeof globalThis & {
	[placementKey]?: { tail: Promise<void>; retained: Set<string> };
};
export const placement = (queueGlobal[placementKey] ??= {
	tail: Promise.resolve(),
	retained: new Set<string>(),
});

/** Queue time counts. A cancelled/expired queued job can never dispatch later. */
export function withPlacement<T>(
	deadline: Deadline,
	signal: AbortSignal | undefined,
	action: () => Promise<T>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		let abandoned = false;
		const abandon = () => {
			abandoned = true;
			reject(signal?.reason ?? new Error("Placement deadline exceeded"));
		};
		const timer = setTimeout(abandon, deadline.remainingMs());
		signal?.addEventListener("abort", abandon, { once: true });
		if (signal?.aborted) abandon();
		const job = placement.tail.then(async () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abandon);
			if (abandoned) return;
			try {
				deadline.remainingMs();
				signal?.throwIfAborted();
				resolve(await action());
			} catch (error) {
				reject(error);
			}
		});
		placement.tail = job.catch(() => {});
	});
}
