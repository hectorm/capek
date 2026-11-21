import type enUS from "./en-US";

export default (): ReturnType<typeof enUS> => ({
  datasources: {
    pages: {
      studio: {
        datasources: {
          title: "Gestión de fuentes de datos",
          description: "Gestionar fuentes de datos",
          tab: "Fuentes de datos",
          table: {
            name: "Nombre",
            description: "Descripción",
            type: "Tipo",
          },
          actions: {
            create: {
              success: {
                title: "Éxito",
                description: "Fuente de datos creada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear la fuente de datos",
              },
            },
            update: {
              success: {
                title: "Éxito",
                description: "Fuente de datos actualizada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar la fuente de datos",
              },
            },
            delete: {
              success: {
                title: "Éxito",
                description: "Fuente de datos eliminada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar la fuente de datos",
              },
            },
          },
          create: {
            title: "Crear fuente de datos",
            description: "Añadir una nueva fuente de datos",
          },
          edit: {
            title: "Editar fuente de datos",
            description: "Actualizar la configuración de la fuente de datos",
          },
          delete: {
            title: "Eliminar fuente de datos",
            description: "Confirmar la eliminación permanente de esta fuente de datos",
            confirm: '¿Está seguro de que desea eliminar la fuente de datos "{name}"?',
          },
          form: {
            name: {
              label: "Nombre",
              placeholder: "Introduzca el nombre de la fuente de datos",
            },
            description: {
              label: "Descripción",
              placeholder: "Introduzca la descripción de la fuente de datos",
            },
            documentation: {
              label: "Documentación",
              placeholder:
                "Describa el esquema de la fuente de datos y sus relaciones, e incluya ejemplos de consultas para ayudar al agente a generar consultas correctas",
            },
            type: {
              label: "Tipo",
              placeholder: "Seleccione un tipo de fuente de datos",
              unsupported: "Este tipo de fuente de datos no se admite",
            },
            connectionString: {
              label: "Cadena de conexión",
            },
            authType: {
              label: "Autenticación",
              placeholder: "Seleccione un tipo de autenticación",
              options: {
                basic: "Usuario y contraseña",
                "azure-service-principal": "Service principal de Microsoft Entra ID",
                "azure-managed-identity": "Managed identity de Microsoft Entra ID",
                none: "Sin autenticación",
              },
            },
            username: {
              label: "Nombre de usuario",
              placeholder: "Introduzca el nombre de usuario de la fuente de datos",
            },
            password: {
              label: "Contraseña",
              placeholder: "Introduzca la contraseña de la fuente de datos",
            },
            azureTenantId: {
              label: "Tenant ID",
              placeholder: "Introduzca el tenant ID de Microsoft Entra ID",
            },
            azureClientId: {
              label: "Client ID",
              placeholder: "Introduzca el client ID de Microsoft Entra ID",
            },
            azureClientSecret: {
              label: "Client secret",
              placeholder: "Introduzca el client secret de Microsoft Entra ID",
            },
            testConnection: {
              label: "Probar conexión",
              testing: "Probando...",
              success: "Conexión exitosa",
              error: "Conexión fallida",
            },
            cancel: "Cancelar",
            create: "Crear",
            save: "Guardar",
          },
        },
      },
    },
    tools: {
      label: "Fuentes de datos",
    },
  },
});
