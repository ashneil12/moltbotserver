/**
 * LazyEventLogger — shared eager-init singleton for the EventLogger.
 *
 * Both `scan-and-log.ts` and `security-event-journal.ts` need an EventLogger
 * that starts importing at module load time (eager) but doesn't block the
 * caller if the import hasn't resolved yet (lazy fallback). This helper
 * encapsulates that pattern so each consumer is a one-liner.
 *
 * Usage:
 *   const logger = new LazyEventLogger();           // kicks off import
 *   const instance = logger.get();                   // null until ready
 *   logger.resetForTest();                           // clears state in tests
 */

import type { EventLogger } from "../logging/event-log.js";

export class LazyEventLogger {
  private _cached: EventLogger | null = null;
  private _initPromise: Promise<void> | null = null;

  constructor() {
    this.init();
  }

  /** Kick off the dynamic import. Safe to call multiple times. */
  init(): void {
    if (this._cached || this._initPromise) {
      return;
    }
    this._initPromise = import("../logging/event-log.js")
      .then(({ createEventLogger }) => {
        this._cached = createEventLogger({});
      })
      .catch(() => {
        // Allow retry on next call
        this._initPromise = null;
      });
  }

  /** Return the logger if initialised, otherwise attempt init and return null. */
  get(): EventLogger | null {
    if (!this._cached) {
      this.init();
    }
    return this._cached;
  }

  /** Clear all state — for use in test `beforeEach` / `afterEach`. */
  resetForTest(): void {
    this._cached = null;
    this._initPromise = null;
  }
}
