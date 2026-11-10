# Datasources

This feature lets users connect the application to their ClickHouse, MariaDB, PostgreSQL and SQL Server databases. Datasources are set up in the Studio, where their builders describe the schema of each one and choose who can use it.

Datasources are shared with users and groups, either as editors, who can update, delete and share them, or as users, who can use them. Queries run in read-only mode. SQL Server cannot enforce it, so its datasources should connect with a user that can only read.

## Tools

Datasources provide the `datasources_query` tool to the agents of the AI feature they are assigned to, which receive their documentation to write the queries.

## Configuration

The `datasources` section of the seed configuration creates datasources:

```yaml
datasources:
  sources:
    - name: "sales"
      type: "postgres"
      config:
        connectionString: "postgres://db.example.com:5432/sales"
        authType: "none"
```
