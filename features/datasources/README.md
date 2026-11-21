# Datasources

This feature lets users connect the application to their ClickHouse, MariaDB, PostgreSQL and SQL Server databases.
Datasources are set up in the Studio, where their builders describe the schema of each one and choose who can use it.

When the AI feature is enabled, datasources provide the `datasources_query` tool to the agents they are assigned to.
Agents receive the documentation of those datasources to write queries.

## Access

Datasources are shared with users and groups, either as editors, who can update, delete and share them, or as users, who
can use them. The application tries to run queries in read-only mode, but how it does so varies with each type of
datasource and it is not a hard limit, so datasources should connect with a user that can only read.

Administrators and creators create datasources. Members use the ones that are shared with them, and auditors can read
all of them.

## Configuration

The `datasources` section of the [seed configuration](../core/README.md#seed) creates datasources.

```yaml
datasources:
  sources:
    - name: "sales"
      type: "postgres"
      config:
        connectionString: "postgres://db.example.com:5432/sales"
        authType: "none"
```
