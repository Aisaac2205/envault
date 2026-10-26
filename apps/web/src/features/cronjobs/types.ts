export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Connection {
  id: string;
  name: string;
  slug: string;
  environment: string;
  dbType?: "postgres" | "mysql";
  host?: string;
  database?: string;
}

// Mirrors the API's structured schedule. The API owns turning it into a cron
// expression, so the web never builds, parses or shows one.
export type EveryHours = 1 | 2 | 3 | 4 | 6 | 8 | 12;

export type ScheduleKind = "every_hours" | "daily" | "weekly" | "monthly";

export interface EveryHoursSchedule {
  kind: "every_hours";
  everyHours: EveryHours;
}

export interface DailySchedule {
  kind: "daily";
  /** 24h `HH:mm`. */
  time: string;
}

export interface WeeklySchedule {
  kind: "weekly";
  /** 24h `HH:mm`. */
  time: string;
  /** 0 = Sunday .. 6 = Saturday. */
  daysOfWeek: number[];
}

export interface MonthlySchedule {
  kind: "monthly";
  /** 24h `HH:mm`. */
  time: string;
  /** 1..28, so every month has the day. */
  dayOfMonth: number;
}

export type Schedule =
  | EveryHoursSchedule
  | DailySchedule
  | WeeklySchedule
  | MonthlySchedule;

export interface RetentionFields {
  retentionEnabled?: boolean;
  retentionKeepLast?: number;
  retentionMaxAgeDays?: number;
  retentionMaxSizeMb?: number;
}

export interface Cronjob extends RetentionFields {
  id: string;
  name: string;
  connectionId: string;
  connectionName?: string;
  /** `null` when the stored expression is one the schedule builder cannot represent. */
  schedule: Schedule | null;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  lastStatus?: JobStatus;
}

export interface CreateCronjobDto extends RetentionFields {
  name: string;
  connectionId: string;
  schedule: Schedule;
}

export interface UpdateCronjobDto extends RetentionFields {
  name?: string;
  connectionId?: string;
  /** Left out to keep the current schedule untouched. */
  schedule?: Schedule;
  isActive?: boolean;
}

