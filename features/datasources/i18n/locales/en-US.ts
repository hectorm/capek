export default () => ({
  datasources: {
    pages: {
      studio: {
        datasources: {
          title: "Datasource management",
          description: "Manage datasources",
          tab: "Datasources",
          table: {
            name: "Name",
            description: "Description",
            type: "Type",
          },
          actions: {
            create: {
              success: {
                title: "Success",
                description: "Datasource created successfully",
              },
              error: {
                title: "Error",
                description: "Failed to create datasource",
              },
            },
            update: {
              success: {
                title: "Success",
                description: "Datasource updated successfully",
              },
              error: {
                title: "Error",
                description: "Failed to update datasource",
              },
            },
            delete: {
              success: {
                title: "Success",
                description: "Datasource deleted successfully",
              },
              error: {
                title: "Error",
                description: "Failed to delete datasource",
              },
            },
          },
          create: {
            title: "Create datasource",
            description: "Add a new datasource",
          },
          edit: {
            title: "Edit datasource",
            description: "Update datasource settings",
          },
          delete: {
            title: "Delete datasource",
            description: "Confirm the permanent removal of this datasource",
            confirm: 'Are you sure you want to delete the datasource "{name}"?',
          },
          form: {
            name: {
              label: "Name",
              placeholder: "Enter datasource name",
            },
            description: {
              label: "Description",
              placeholder: "Enter datasource description",
            },
            documentation: {
              label: "Documentation",
              placeholder:
                "Describe the datasource schema, relationships, and include example queries to help the agent generate correct queries",
            },
            type: {
              label: "Type",
              placeholder: "Select a datasource type",
              unsupported: "This type of datasource is not supported",
            },
            connectionString: {
              label: "Connection string",
            },
            authType: {
              label: "Authentication",
              placeholder: "Select an authentication type",
              options: {
                basic: "Username and password",
                "azure-service-principal": "Microsoft Entra ID service principal",
                "azure-managed-identity": "Microsoft Entra ID managed identity",
                none: "No authentication",
              },
            },
            username: {
              label: "Username",
              placeholder: "Enter datasource username",
            },
            password: {
              label: "Password",
              placeholder: "Enter datasource password",
            },
            azureTenantId: {
              label: "Tenant ID",
              placeholder: "Enter Microsoft Entra ID tenant ID",
            },
            azureClientId: {
              label: "Client ID",
              placeholder: "Enter Microsoft Entra ID client ID",
            },
            azureClientSecret: {
              label: "Client secret",
              placeholder: "Enter Microsoft Entra ID client secret",
            },
            testConnection: {
              label: "Test connection",
              testing: "Testing...",
              success: "Connection successful",
              error: "Connection failed",
            },
            cancel: "Cancel",
            create: "Create",
            save: "Save",
          },
        },
      },
    },
    tools: {
      label: "Datasources",
    },
  },
});
