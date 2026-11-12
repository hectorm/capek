import { Buffer } from "node:buffer";

import type { TokenCredential } from "@azure/identity";
import type { ConnectionAuthentication, ConnectionOptions } from "tedious";
import { ManagedIdentityCredential } from "@azure/identity";
import { parse } from "@tediousjs/connection-string";
import { Connection, Request } from "tedious";

import type {
  DatasourceConnectionParams,
  DatasourceDriver,
  DatasourceQuerySettings,
} from "#layers/datasources/server/lib/drivers";
import { ResultTooLargeError } from "#layers/datasources/server/lib/errors";
import { SqlServerDatasourceType } from "#layers/datasources/shared/definitions/sqlserver";

interface TediousColumn {
  metadata: { colName: string };
  value: unknown;
}

interface ParseTarget {
  server: string;
  options: ConnectionOptions;
}

type SqlServerConfig = ReturnType<typeof SqlServerDatasourceType.configSchema.parse>;

const AZURE_DATABASE_HOST_SUFFIXES = [
  ".database.windows.net",
  ".database.usgovcloudapi.net",
  ".database.chinacloudapi.cn",
  ".database.cloudapi.de",
  ".sql.azuresynapse.net",
  ".datawarehouse.fabric.microsoft.com",
  ".database.fabric.microsoft.com",
];

const DATABASE_TOKEN_SCOPES = new Set([
  "https://database.windows.net/.default",
  "https://database.usgovcloudapi.net/.default",
  "https://database.chinacloudapi.cn/.default",
  "https://database.cloudapi.de/.default",
]);

const databaseCredential = (clientId: string): TokenCredential => {
  const credential = new ManagedIdentityCredential(clientId ? { clientId } : undefined);
  return {
    getToken: (scopes, options) => {
      const requested = [scopes].flat();
      if (!requested.every((scope) => DATABASE_TOKEN_SCOPES.has(scope))) {
        return Promise.reject(
          new Error(`The server asked for a token for "${requested.join(", ")}", which is not a database`),
        );
      }
      return credential.getToken(scopes, options);
    },
  };
};

export class SqlServerDriver implements DatasourceDriver {
  readonly validationQuery = "SELECT 1";

  async execute(
    params: DatasourceConnectionParams,
    sql: string,
    settings: DatasourceQuerySettings,
  ): Promise<unknown[]> {
    const config = SqlServerDatasourceType.configSchema.parse(params.config);

    const { server, options } = this.parseConnectionString(config.connectionString);
    const authentication = this.buildAuthentication(config);

    if (config.authType === "azure-managed-identity") {
      if (!AZURE_DATABASE_HOST_SUFFIXES.some((suffix) => server.toLowerCase().endsWith(suffix))) {
        throw new Error(
          `Managed identities only connect to the databases of Azure, and "${server}" is not one of them`,
        );
      }
      options.encrypt = options.encrypt === "strict" ? "strict" : true;
      options.trustServerCertificate = false;
    }

    options.readOnlyIntent = true;
    // Changes are discarded on close since nothing is committed, unless a statement commits them itself
    options.enableImplicitTransactions = true;
    if (settings.requestTimeoutMs) options.connectTimeout = settings.requestTimeoutMs;
    if (settings.statementTimeoutMs) options.requestTimeout = settings.statementTimeoutMs;
    if (settings.maxBytes) options.textsize = 2 * settings.maxBytes;

    const connection = new Connection({ server, authentication, options });
    const onAbort = (): void => {
      connection.cancel();
    };

    try {
      settings.signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        connection.once("connect", (err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
        connection.once("error", reject);
        connection.connect();
      });

      settings.signal?.addEventListener("abort", onAbort, { once: true });
      settings.signal?.throwIfAborted();
      return await new Promise<unknown[]>((resolve, reject) => {
        const rows: Record<string, unknown>[] = [];
        let bytes = 0;
        let hasResultSet = false;
        let cancelled = false;
        const request = new Request(sql, (err) => {
          if (err && !cancelled) reject(err);
          else if (!hasResultSet)
            reject(new Error("The statement returned no result, and changes to data are not kept"));
          else resolve(rows);
        });
        request.on("columnMetadata", () => {
          hasResultSet = true;
        });
        request.on("row", (columns: TediousColumn[]) => {
          if (cancelled) return;
          if (settings.maxRows && rows.length >= settings.maxRows) {
            cancelled = true;
            connection.cancel();
            return;
          }
          const row = this.toRow(columns);
          rows.push(row);
          bytes += Buffer.byteLength(JSON.stringify(row));
          if (settings.maxBytes && bytes > settings.maxBytes) {
            cancelled = true;
            connection.cancel();
            reject(new ResultTooLargeError(settings.maxBytes));
          }
        });
        connection.execSqlBatch(request);
      });
    } finally {
      settings.signal?.removeEventListener("abort", onAbort);
      try {
        connection.close();
      } catch {
        // ignore
      }
    }
  }

  // Columns without a name, or with a repeated one, are named after their position so that none is lost
  private toRow(columns: TediousColumn[]): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    columns.forEach((column, i) => {
      const name = column.metadata.colName;
      row[name && !(name in row) ? name : `column${String(i + 1)}`] = column.value;
    });
    return row;
  }

  private buildAuthentication(config: SqlServerConfig): ConnectionAuthentication {
    switch (config.authType) {
      case "basic":
        return {
          type: "default",
          options: {
            userName: config.username,
            password: config.password,
          },
        };
      case "azure-service-principal":
        return {
          type: "azure-active-directory-service-principal-secret",
          options: {
            tenantId: config.azureTenantId,
            clientId: config.azureClientId,
            clientSecret: config.azureClientSecret,
          },
        };
      case "azure-managed-identity":
        return {
          type: "token-credential",
          options: {
            credential: databaseCredential(config.azureClientId),
          },
        };
      case "none":
        return { type: "default", options: {} };
    }
  }

  private parseConnectionString(connectionString: string): ParseTarget {
    const target: ParseTarget = { server: "", options: {} };

    for (const [key, value] of parse(connectionString)) {
      switch (key) {
        case "addr":
        case "address":
        case "server":
        case "network address":
        case "data source": {
          // Parse "[tcp:]host[\instance][,port]"
          let host = value.trim().replace(/^tcp:\s*/i, "");
          const commaIdx = host.lastIndexOf(",");
          if (commaIdx >= 0) {
            const port = Number.parseInt(host.slice(commaIdx + 1).trim(), 10);
            if (!Number.isNaN(port)) {
              target.options.port = port;
              host = host.slice(0, commaIdx).trim();
            }
          }
          const bsIdx = host.indexOf("\\");
          if (bsIdx >= 0) {
            target.options.instanceName = host.slice(bsIdx + 1).trim();
            host = host.slice(0, bsIdx).trim();
          }
          target.server = host;
          break;
        }
        case "database":
        case "initial catalog":
          target.options.database = value;
          break;
        case "encrypt":
          target.options.encrypt = value.trim().toLowerCase() === "strict" ? "strict" : this.toBoolean(value);
          break;
        case "trustservercertificate":
          target.options.trustServerCertificate = this.toBoolean(value);
          break;
        case "multisubnetfailover":
          target.options.multiSubnetFailover = this.toBoolean(value);
          break;
        case "packet size":
          target.options.packetSize = this.toNumber(value);
          break;
        case "connectretrycount":
          target.options.maxRetriesOnTransientErrors = this.toNumber(value);
          break;
        case "connectretryinterval":
          target.options.connectionRetryInterval = this.toNumber(value) * 1000;
          break;
        case "language":
        case "current language":
          target.options.language = value;
          break;
        case "wsid":
        case "workstation id":
          target.options.workstationId = value;
          break;
      }
    }

    return target;
  }

  private toBoolean(value: string): boolean {
    const trimmed = value.trim();
    if (/^(true|yes|1)$/i.test(trimmed)) return true;
    if (/^(false|no|0)$/i.test(trimmed)) return false;
    throw new Error(`Invalid boolean value in connection string: ${value}`);
  }

  private toNumber(value: string): number {
    const n = Number(value.trim());
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid numeric value in connection string: ${value}`);
    }
    return n;
  }
}
