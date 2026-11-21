import type enUS from "./en-US";

export default (): ReturnType<typeof enUS> => ({
  ai: {
    pages: {
      welcome: {
        title: "Bienvenido/a",
        description: "Iniciar una conversación",
        newChat: "Nuevo chat",
        prompt: {
          enterMessage: "Escriba su mensaje aquí...",
        },
        actions: {
          fetchAgents: {
            error: {
              title: "Error",
              description: "Error al cargar los agentes",
            },
          },
          fetchChats: {
            error: {
              title: "Error",
              description: "Error al cargar las sesiones de chat",
            },
          },
          createChat: {
            error: {
              title: "Error",
              description: "Error al crear la sesión de chat",
            },
          },
          deleteChat: {
            success: {
              title: "Éxito",
              description: "Sesión de chat eliminada correctamente",
            },
            error: {
              title: "Error",
              description: "Error al eliminar la sesión de chat",
            },
          },
        },
      },
      chat: {
        title: "Chat",
        description: "Sesión de chat",
        untitled: "Sin título",
        toolCalls: {
          calls: "{count} llamadas",
          tools: "{count} llamadas a herramientas",
        },
        errors: {
          timeout: "La respuesta ha tardado más de lo que se le permite al agente",
          maxIterations: "El agente ha alcanzado su número máximo de pasos sin terminar la respuesta",
          refusal: "El modelo ha rechazado responder a esta petición",
          maxOutputTokens: "La respuesta se ha cortado porque ha alcanzado el número máximo de tokens",
        },
        editMessage: "Editar mensaje",
        dateGroups: {
          today: "Hoy",
          yesterday: "Ayer",
          lastWeek: "Últimos 7 días",
          lastMonth: "Último mes",
        },
        actions: {
          menu: "Menú de acciones",
          copy: "Copiar",
          edit: "Editar",
          cancel: "Cancelar",
          resend: "Reenviar",
          retry: "Reintentar",
          regenerate: "Regenerar",
          rename: "Renombrar",
          delete: "Eliminar",
          fetchChat: {
            error: {
              title: "Error",
              description: "Error al cargar la sesión de chat",
            },
          },
          sendMessage: {
            error: {
              title: "Error",
              description: "Error al enviar el mensaje",
            },
          },
          retryMessage: {
            error: {
              title: "Error",
              description: "Error al reintentar el mensaje",
            },
          },
          regenerateMessage: {
            error: {
              title: "Error",
              description: "Error al regenerar el mensaje",
            },
          },
          deleteMessage: {
            error: {
              title: "Error",
              description: "Error al eliminar el mensaje",
            },
          },
          renameSession: {
            success: {
              title: "Éxito",
              description: "Sesión de chat renombrada correctamente",
            },
            error: {
              title: "Error",
              description: "Error al renombrar la sesión de chat",
            },
          },
          updateSession: {
            error: {
              title: "Error",
              description: "Error al actualizar la sesión de chat",
            },
          },
        },
      },
      studio: {
        agents: {
          title: "Gestión de agentes",
          description: "Gestionar agentes de IA",
          tab: "Agentes",
          table: {
            name: "Nombre",
            description: "Descripción",
            type: "Tipo",
            model: "Modelo",
            priority: "Prioridad",
          },
          actions: {
            create: {
              success: {
                title: "Éxito",
                description: "Agente creado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear el agente",
              },
            },
            update: {
              success: {
                title: "Éxito",
                description: "Agente actualizado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar el agente",
              },
            },
            delete: {
              success: {
                title: "Éxito",
                description: "Agente eliminado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar el agente",
              },
            },
          },
          create: {
            title: "Crear agente",
            description: "Añadir un nuevo agente",
          },
          edit: {
            title: "Editar agente",
            description: "Actualizar configuración del agente",
          },
          delete: {
            title: "Eliminar agente",
            description: "Confirmar la eliminación permanente de este agente",
            confirm: '¿Está seguro de que desea eliminar el agente "{name}"?',
          },
          form: {
            name: {
              label: "Nombre",
              placeholder: "Introduzca el nombre del agente",
            },
            description: {
              label: "Descripción",
              placeholder: "Introduzca la descripción del agente",
            },
            instructions: {
              label: "Instrucciones",
              placeholder: "Proporcione instrucciones específicas para el comportamiento y respuestas del agente",
            },
            greetingMessage: {
              label: "Mensaje de bienvenida",
              placeholder: "Mensaje mostrado a los usuarios al inicio de una sesión de chat con este agente",
            },
            priority: {
              label: "Prioridad",
              hint: "Los agentes con mayor prioridad se listan primero",
            },
            type: {
              label: "Tipo",
              specialist: "Especialista",
              triage: "Triaje",
            },
            specialists: {
              label: "Especialistas",
              placeholder: "Seleccione especialistas (solo triaje)",
            },
            llmProvider: {
              label: "Proveedor de LLM",
              placeholder: "Seleccione un proveedor de LLM",
            },
            model: {
              label: "Modelo",
              placeholder: "Modelo a usar para este agente",
            },
            summaryModel: {
              label: "Modelo de resumen",
              placeholder: "Déjalo vacío para usar el modelo principal",
            },
            reasoningEffort: {
              label: "Esfuerzo de razonamiento",
              placeholder: "Déjalo vacío para usar el predeterminado del modelo",
            },
            mcpServers: {
              label: "Servidores MCP",
              placeholder: "Seleccione servidores MCP",
              hint: "Servidores MCP que los agentes pueden usar durante la ejecución",
            },
            skills: {
              label: "Habilidades",
              placeholder: "Seleccione habilidades",
              hint: "Habilidades disponibles para el agente durante la ejecución",
            },
            toolResources: {
              placeholder: "Seleccione recursos",
              hint: "Recursos cuyas herramientas están disponibles para el agente durante la ejecución",
            },
            codeInterpreter: {
              label: "Intérprete de código",
              description: "Habilitar ejecución de código para este agente",
            },
            showToolCalls: {
              label: "Llamadas a herramientas",
              description: "Mostrar las llamadas a herramientas de este agente",
            },
            streaming: {
              label: "Streaming",
              description: "Habilitar respuestas en streaming para este agente",
            },
            advancedSettings: {
              label: "Configuración avanzada",
              customized: "{count} personalizados",
              default: "Por defecto: {value}",
            },
            temperature: {
              label: "Temperatura",
              hint: "Controla la aleatoriedad (0 = enfocado, 2 = creativo)",
            },
            maxTokens: {
              label: "Tokens máximos",
              hint: "Longitud máxima de respuesta",
            },
            topP: {
              label: "Top-p",
              hint: "Limita las opciones de palabras a las más probables (menor = más predecible)",
            },
            frequencyPenalty: {
              label: "Penalización de frecuencia",
              hint: "Reduce la repetición de tokens",
            },
            presencePenalty: {
              label: "Penalización de presencia",
              hint: "Fomenta nuevos temas",
            },
            maxIterations: {
              label: "Iteraciones máximas",
              hint: "Número máximo de iteraciones de llamadas a herramientas por ejecución del agente",
            },
            timeoutSec: {
              label: "Tiempo de espera (segundos)",
              hint: "Tiempo máximo de ejecución en segundos antes de que se termine el agente",
            },
            maxContextChars: {
              label: "Caracteres máximos de contexto",
              hint: "Caracteres totales máximos para el contexto de mensajes enviado al modelo",
            },
            maxToolResponseChars: {
              label: "Caracteres máximos de respuesta de herramienta",
              hint: "Caracteres máximos para una respuesta de herramienta antes del truncamiento",
            },
            maxToolPartsChars: {
              label: "Caracteres máximos de partes de herramienta",
              hint: "Caracteres totales máximos para lo que las herramientas muestran en una respuesta, como los gráficos",
            },
            testModel: {
              label: "Probar modelo",
              testing: "Probando...",
              success: "Prueba del modelo exitosa",
              error: "Prueba del modelo fallida",
            },
            cancel: "Cancelar",
            create: "Crear",
            save: "Guardar",
          },
        },
        llmProviders: {
          title: "Gestión de proveedores LLM",
          description: "Gestionar proveedores LLM",
          tab: "Proveedores LLM",
          table: {
            name: "Nombre",
            description: "Descripción",
            apiUrl: "URL de API",
          },
          actions: {
            create: {
              success: {
                title: "Éxito",
                description: "Proveedor LLM creado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear el proveedor LLM",
              },
            },
            update: {
              success: {
                title: "Éxito",
                description: "Proveedor LLM actualizado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar el proveedor LLM",
              },
            },
            delete: {
              success: {
                title: "Éxito",
                description: "Proveedor LLM eliminado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar el proveedor LLM",
              },
            },
          },
          create: {
            title: "Crear proveedor LLM",
            description: "Añadir un nuevo proveedor LLM",
          },
          edit: {
            title: "Editar proveedor LLM",
            description: "Actualizar la configuración del proveedor LLM",
          },
          delete: {
            title: "Eliminar proveedor LLM",
            description: "Confirmar la eliminación permanente de este proveedor LLM",
            confirm: '¿Está seguro de que desea eliminar el proveedor LLM "{name}"?',
          },
          form: {
            name: {
              label: "Nombre",
              placeholder: "Introduzca el nombre del proveedor de LLM",
            },
            description: {
              label: "Descripción",
              placeholder: "Introduzca la descripción del proveedor de LLM",
            },
            apiUrl: {
              label: "URL de API",
              placeholder: "https://api.example.com/v1",
            },
            apiType: {
              label: "Tipo de API",
              chatCompletions: "Chat Completions",
              responses: "Responses",
              messages: "Messages",
            },
            apiKey: {
              label: "Clave de API",
              placeholder: "Introduzca la clave de API",
            },
            headers: {
              label: "Cabeceras personalizadas",
              namePlaceholder: "Nombre de cabecera",
              valuePlaceholder: "Valor de cabecera",
              add: "Añadir cabecera",
              remove: "Eliminar cabecera",
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
        mcpServers: {
          title: "Gestión de servidores MCP",
          description: "Gestionar servidores MCP",
          tab: "Servidores MCP",
          table: {
            name: "Nombre",
            description: "Descripción",
            url: "URL",
          },
          actions: {
            create: {
              success: {
                title: "Éxito",
                description: "Servidor MCP creado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear el servidor MCP",
              },
            },
            update: {
              success: {
                title: "Éxito",
                description: "Servidor MCP actualizado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar el servidor MCP",
              },
            },
            delete: {
              success: {
                title: "Éxito",
                description: "Servidor MCP eliminado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar el servidor MCP",
              },
            },
          },
          create: {
            title: "Crear servidor MCP",
            description: "Añadir un nuevo servidor MCP",
          },
          edit: {
            title: "Editar servidor MCP",
            description: "Actualizar la configuración del servidor MCP",
          },
          delete: {
            title: "Eliminar servidor MCP",
            description: "Confirmar la eliminación permanente de este servidor MCP",
            confirm: '¿Está seguro de que desea eliminar el servidor MCP "{name}"?',
          },
          form: {
            name: {
              label: "Nombre",
              placeholder: "Introduzca el nombre del servidor MCP",
            },
            description: {
              label: "Descripción",
              placeholder: "Introduzca la descripción del servidor MCP",
            },
            url: {
              label: "URL",
              placeholder: "http://example.com/mcp",
            },
            headers: {
              label: "Cabeceras personalizadas",
              namePlaceholder: "Nombre de cabecera",
              valuePlaceholder: "Valor de cabecera",
              add: "Añadir cabecera",
              remove: "Eliminar cabecera",
            },
            stateful: {
              label: "Sesión con estado",
              description: "El servidor mantiene el estado entre solicitudes",
            },
            advancedSettings: {
              label: "Configuración avanzada",
              customized: "{count} personalizados",
              default: "Por defecto: {value}",
            },
            toolCallTimeoutSec: {
              label: "Tiempo de espera de llamada a herramienta (segundos)",
              hint: "Tiempo máximo en segundos para esperar una respuesta de llamada a herramienta",
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
        skills: {
          title: "Gestión de habilidades",
          description: "Gestionar habilidades para agentes",
          tab: "Habilidades",
          table: {
            name: "Nombre",
            description: "Descripción",
          },
          actions: {
            create: {
              success: {
                title: "Éxito",
                description: "Habilidad creada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear la habilidad",
              },
            },
            update: {
              success: {
                title: "Éxito",
                description: "Habilidad actualizada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar la habilidad",
              },
            },
            delete: {
              success: {
                title: "Éxito",
                description: "Habilidad eliminada correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar la habilidad",
              },
            },
          },
          create: {
            title: "Crear habilidad",
            description: "Añadir una nueva habilidad",
          },
          edit: {
            title: "Editar habilidad",
            description: "Actualizar configuración de la habilidad",
          },
          delete: {
            title: "Eliminar habilidad",
            description: "Confirmar la eliminación permanente de esta habilidad",
            confirm: '¿Está seguro de que desea eliminar la habilidad "{name}"?',
          },
          form: {
            name: {
              label: "Nombre",
              placeholder: "Introduzca el nombre de la habilidad",
            },
            description: {
              label: "Descripción",
              placeholder: "Introduzca la descripción de la habilidad",
            },
            documentation: {
              label: "Documentación",
              placeholder: "Introduzca la documentación",
            },
            code: {
              label: "Código",
              placeholder: "Introduzca el código JavaScript",
            },
            cancel: "Cancelar",
            create: "Crear",
            save: "Guardar",
          },
        },
      },
      settings: {
        general: {
          categories: {
            welcome: "Página de bienvenida",
          },
          fields: {
            "ai.quickChats": {
              label: "Prompts rápidos",
              description: "Prompts predefinidos que se muestran en la página de bienvenida",
              placeholder: "Introduzca un prompt",
              add: "Añadir prompt",
              remove: "Eliminar prompt",
            },
          },
        },
      },
    },
    components: {
      agentSelect: {
        label: "Seleccionar agente",
      },
      chat: {
        renameModal: {
          title: "Renombrar sesión de chat",
          description: "Introduzca un nuevo título para esta sesión de chat",
          form: {
            title: {
              label: "Título",
              placeholder: "Introduzca el título de la sesión de chat",
            },
            save: {
              label: "Guardar",
            },
            cancel: {
              label: "Cancelar",
            },
          },
        },
        deleteModal: {
          title: "Eliminar sesión de chat",
          description: "Confirmar la eliminación permanente de esta sesión de chat",
          form: {
            message: '¿Está seguro de que desea eliminar la sesión de chat "{title}"?',
            delete: {
              label: "Eliminar",
            },
            cancel: {
              label: "Cancelar",
            },
          },
        },
        chartFrame: {
          title: "Gráfico",
          error: "No se pudo mostrar el gráfico",
          export: {
            label: "Descargar",
            png: "Imagen PNG",
            svg: "Imagen SVG",
          },
          fullscreen: {
            enter: "Pantalla completa",
            exit: "Salir de pantalla completa",
          },
        },
        tableView: {
          rows: "Filas: {total}",
          filtered: "Filas: {shown} de {total}",
          preview: "Primeras {shown} filas de {total}",
          showAll: "Mostrar todas",
          sort: "Ordenar por {column}",
          filter: "Filtrar por {column}",
          search: "Buscar",
          export: {
            label: "Descargar CSV",
          },
          fullscreen: {
            enter: "Pantalla completa",
            exit: "Salir de pantalla completa",
          },
          error: {
            title: "Error",
            description: "No se pudo cargar la tabla",
          },
        },
        sessionsSidebar: {
          history: "Historial de chats",
          deleteChat: "Eliminar chat",
        },
      },
    },
    tools: {
      charts: {
        label: "Gráficos",
        description: "Habilitar gráficos para este agente",
      },
      tables: {
        label: "Tablas",
        description: "Habilitar tablas para este agente",
      },
    },
  },
});
