export type CronJobBase<TSchedule, TSessionTarget, TWakeMode, TPayload, TDelivery, TFailureAlert> =
  {
    id: string;
    agentId?: string;
    sessionKey?: string;
    name: string;
    description?: string;
    enabled: boolean;
    deleteAfterRun?: boolean;
    createdAtMs: number;
    updatedAtMs: number;
    schedule: TSchedule;
    sessionTarget: TSessionTarget;
    wakeMode: TWakeMode;
    payload: TPayload;
    delivery?: TDelivery;
    failureAlert?: TFailureAlert;
    /**
     * When true, the job is deferred until the user is idle (no recent activity)
     * or the current time falls within a configured sleep window.
     * Inspired by MetaClaw's OMLS (Opportunistic Meta-Learning Scheduler).
     */
    idleOnly?: boolean;
  };
