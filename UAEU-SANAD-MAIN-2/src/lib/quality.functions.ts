/** Shared quality DTOs. Quality operations are implemented by SanadiAPI. */
export type QualityDashboard = {
  targets:{metricKey:string;labelEn:string;labelAr:string;target:number;measured:number|null;unit:string;comparator:string;isCritical:boolean;meets:boolean|null;sampleSize:number}[];
  latency:{category:string;budgetMs:number|null;p50:number;p90:number;p95:number;p99:number;samples:number;breaches:number}[];
  firstFeedbackP95:number; grounding:{checks:number;passRate:number;avgScore:number;unsupportedClaims:number};
  reliability:{runs:number;fallbackRate:number;handoffRate:number;partialFailureRate:number};
  readiness:{gateKey:string;labelEn:string;labelAr:string;status:string;isBlocking:boolean;notes:string|null}[];
  health:{component:string;state:string;messageEn:string|null;messageAr:string|null}[];
  reviews:{total:number;averages:Record<string,number>};
};
export type PerformanceDashboard = {
  windowHours:number; totals:{requests:number;requestsPerMinute:number;activeUsers:number;errorRate:number;timeoutRate:number;rateLimitEvents:number;avgModelCalls:number;avgTokens:number};
  overall:{p50:number;p90:number;p95:number;p99:number;firstFeedbackP95:number;firstTokenP95:number};
  byPath:{path:string;samples:number;p50:number;p95:number;share:number}[]; byCategory:{category:string;samples:number;p50:number;p95:number;p99:number;breaches:number}[];
  byModel:{model:string;samples:number;p50:number;p95:number}[]; phases:{phase:string;p50:number;p95:number}[];
  slowest:{traceId:string|null;category:string;path:string;model:string|null;totalMs:number;createdAt:string;breakdown:{label:string;ms:number}[];modelCalls:number;toolCount:number;tokens:number;success:boolean;errorKind:string|null}[];
};
