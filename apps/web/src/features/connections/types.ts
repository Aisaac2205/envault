export interface Connection {
  id: string;
  name: string;
  slug: string;
  dbType: "postgres" | "mysql";
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * PROD connections cannot be edited on the API, and deleting one takes a
 * step-up confirmation (see {@link ProdDeleteConfirmation}).
 */
export function isProdConnection(connection: Pick<Connection, "environment">): boolean {
  return connection.environment === "prod";
}

/** What the API asks for, in the request body, before it deletes a PROD connection. */
export interface ProdDeleteConfirmation {
  /** The connection's name, exactly as stored (case and spaces count). */
  confirmName: string;
  /** The signed-in admin's current password. */
  password: string;
}

export interface DeleteConnectionVariables {
  id: string;
  /** Required for a PROD connection; omitted for any other. */
  confirmation?: ProdDeleteConfirmation;
}

export interface CreateConnectionDto {
  name: string;
  dbType: "postgres" | "mysql";
  environment: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

export interface UpdateConnectionDto {
  name?: string;
  dbType?: "postgres" | "mysql";
  environment?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  latencyMs: number; // milliseconds
  error?: string;
}

export interface TestRawConnectionDto {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  dbType: "postgres" | "mysql";
}
