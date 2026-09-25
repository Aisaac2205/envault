export interface DumpManifestTable {
  name: string;
  estimatedRows: number;
}

export interface DumpManifestSource {
  serverVersion: string;
  tableCount: number;
  estimatedRows: number;
  tables: DumpManifestTable[];
}

export interface DumpManifestV1 {
  version: 1;
  createdAt: string;
  dbType: string;
  database: string;
  source: DumpManifestSource;
}

export interface DumpManifestV2 {
  version: 2;
  createdAt: string;
  dbType: string;
  database: string;
  source: DumpManifestSource;
  sha256: string;
  bytes: number;
  compression: string;
}

export type DumpManifest = DumpManifestV1 | DumpManifestV2;

