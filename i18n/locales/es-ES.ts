import { defineI18nLocale } from "#i18n";

export default defineI18nLocale(() => ({
  layouts: {
    default: {
      title: "Capek",
      description: "Plataforma de IA conversacional",
      sidebar: {
        title: "Menú",
        description: "Menú de navegación",
        toggle: "Alternar menú lateral",
        label: "Navegación del chat",
        homeLink: "Ir a inicio",
        deleteChat: "Eliminar chat",
      },
    },
  },
  pages: {
    welcome: {
      title: "Bienvenido/a",
      description: "Iniciar una conversación",
      newChat: "Nuevo chat",
      prompt: {
        enterMessage: "Escriba su mensaje aquí...",
      },
      actions: {
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
        editMessage: {
          error: {
            title: "Error",
            description: "Error al editar el mensaje",
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
    settings: {
      title: "Configuración",
      description: "Configuración de la aplicación",
      general: {
        title: "Configuración general",
        description: "Ajustar preferencias generales",
        tab: "General",
        categories: {
          welcome: "Página de bienvenida",
          branding: "Marca",
        },
        fields: {
          "welcome.quickChats": {
            label: "Prompts rápidos",
            description: "Prompts predefinidos que se muestran en la página de bienvenida.",
            placeholder: "Introduzca un prompt",
            add: "Añadir prompt",
            remove: "Eliminar prompt",
          },
          "branding.name": {
            label: "Nombre de la aplicación",
            description: "El nombre que se muestra en el título del navegador y la navegación.",
            placeholder: "Introduzca el nombre de la aplicación",
          },
          "branding.logo": {
            label: "Logotipo de la aplicación",
            description: "Logotipo completo que se muestra en la barra lateral expandida.",
            placeholder: "Cargar imagen (máx. {size} KB)",
          },
          "branding.icon": {
            label: "Icono de la aplicación",
            description: "Icono cuadrado para la barra lateral colapsada y favicon.",
            placeholder: "Cargar imagen (máx. {size} KB)",
          },
          "branding.primaryColor": {
            label: "Color primario",
            description: "Color principal utilizado para botones, enlaces y elementos importantes.",
            placeholder: "Seleccione un color",
          },
          "branding.neutralColor": {
            label: "Color neutral",
            description: "Color utilizado para texto, bordes y fondos.",
            placeholder: "Seleccione un color",
          },
          "branding.radius": {
            label: "Radio de borde",
            description: "Redondeo de las esquinas de los componentes.",
            placeholder: "Seleccione el radio de borde",
          },
        },
        actions: {
          save: "Guardar",
          reset: "Restablecer valor predeterminado",
          usingDefault: "Usando valor predeterminado",
          overridden: "Valor personalizado establecido",
        },
        messages: {
          loading: "Cargando configuración...",
          fetchError: {
            title: "Error",
            description: "Error al cargar la configuración",
          },
          saveSuccess: {
            title: "Éxito",
            description: "Configuración guardada correctamente",
          },
          saveError: {
            title: "Error",
            description: "Error al guardar la configuración",
          },
          resetSuccess: {
            title: "Éxito",
            description: "Configuración restablecida al valor predeterminado",
          },
          resetError: {
            title: "Error",
            description: "Error al restablecer la configuración",
          },
          fileTooLarge: {
            title: "Archivo demasiado grande",
            description: "El tamaño del archivo supera el tamaño máximo permitido de {maxSize} KB",
          },
          invalidFileType: {
            title: "Tipo de archivo inválido",
            description: "El tipo de archivo debe ser uno de: {accept}",
          },
          fileReadError: {
            title: "Error al leer el archivo",
            description: "Error al leer el archivo seleccionado",
          },
        },
      },
      users: {
        title: "Gestión de usuarios",
        description: "Gestionar usuarios y asignar roles",
        tab: "Usuarios",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          username: "Usuario",
          fullname: "Nombre completo",
          email: "Email",
          roles: "Roles",
          groups: "Grupos",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
              success: {
                title: "Éxito",
                description: "Usuario creado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear el usuario",
              },
            },
            update: {
              label: "Editar",
              success: {
                title: "Éxito",
                description: "Usuario actualizado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar el usuario",
              },
            },
            delete: {
              label: "Eliminar",
              success: {
                title: "Éxito",
                description: "Usuario eliminado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar el usuario",
              },
            },
          },
        },
      },
      groups: {
        title: "Gestión de grupos",
        description: "Gestionar grupos y asignar roles",
        tab: "Grupos",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          name: "Nombre",
          description: "Descripción",
          roles: "Roles",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
              success: {
                title: "Éxito",
                description: "Grupo creado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al crear el grupo",
              },
            },
            update: {
              label: "Editar",
              success: {
                title: "Éxito",
                description: "Grupo actualizado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al actualizar el grupo",
              },
            },
            delete: {
              label: "Eliminar",
              success: {
                title: "Éxito",
                description: "Grupo eliminado correctamente",
              },
              error: {
                title: "Error",
                description: "Error al eliminar el grupo",
              },
            },
          },
        },
      },
    },
    studio: {
      title: "Studio",
      description: "Crear y gestionar agentes y herramientas de IA",
      agents: {
        title: "Gestión de agentes",
        description: "Gestionar agentes de IA",
        tab: "Agentes",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          name: "Nombre",
          description: "Descripción",
          type: "Tipo",
          model: "Modelo",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
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
              label: "Editar",
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
              label: "Eliminar",
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
        },
        create: {
          title: "Crear agente",
          description: "Crear un nuevo agente de IA",
        },
        edit: {
          title: "Editar agente",
          description: "Actualizar configuración del agente",
        },
        delete: {
          title: "Eliminar agente",
          description: "Confirmar eliminación permanente de este agente",
          confirm: '¿Está seguro de que desea eliminar el agente "{name}"?',
        },
        form: {
          name: {
            label: "Nombre",
            placeholder: "Introduce el nombre del agente",
          },
          description: {
            label: "Descripción",
            placeholder: "Introduce la descripción del agente",
          },
          instructions: {
            label: "Instrucciones",
            placeholder: "Proporciona instrucciones específicas para el comportamiento y respuestas del agente",
          },
          greetingMessage: {
            label: "Mensaje de bienvenida",
            placeholder: "Mensaje mostrado a los usuarios al inicio de una sesión de chat con este agente",
          },
          editors: {
            label: "Editores",
            placeholder: "Buscar usuarios y grupos",
          },
          users: {
            label: "Usuarios",
            placeholder: "Buscar usuarios y grupos",
          },
          type: {
            label: "Tipo",
            specialist: "Especialista",
            triage: "Triaje",
          },
          specialists: {
            label: "Especialistas",
            placeholder: "Seleccionar especialistas (solo triaje)",
          },
          llmProvider: {
            label: "Proveedor de LLM",
            placeholder: "Seleccionar un proveedor de LLM",
          },
          model: {
            label: "Modelo",
            placeholder: "Modelo a usar para este agente",
          },
          summaryModel: {
            label: "Modelo de resumen",
            placeholder: "Dejar vacío para usar el modelo principal",
          },
          mcpServers: {
            label: "Servidores MCP",
            placeholder: "Seleccionar servidores MCP",
            hint: "Servidores MCP que los agentes pueden usar durante la ejecución",
          },
          skills: {
            label: "Habilidades",
            placeholder: "Seleccionar habilidades",
            hint: "Habilidades disponibles para el agente durante la ejecución",
          },
          codeInterpreter: {
            label: "Intérprete de código",
            description: "Habilitar ejecución de código para este agente",
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
          cancel: "Cancelar",
          create: "Crear",
          save: "Guardar",
          delete: "Eliminar",
        },
      },
      llmProviders: {
        title: "Gestión de proveedores LLM",
        description: "Gestionar proveedores LLM",
        tab: "Proveedores LLM",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          name: "Nombre",
          description: "Descripción",
          apiUrl: "URL de API",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
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
              label: "Editar",
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
              label: "Eliminar",
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
            placeholder: "Introduce el nombre del proveedor de LLM",
          },
          description: {
            label: "Descripción",
            placeholder: "Introduce la descripción del proveedor de LLM",
          },
          apiUrl: {
            label: "URL de API",
            placeholder: "https://api.example.com/v1",
          },
          apiKey: {
            label: "Clave de API",
            placeholder: "Introduce la clave de API",
          },
          headers: {
            label: "Cabeceras personalizadas",
            namePlaceholder: "Nombre de cabecera",
            valuePlaceholder: "Valor de cabecera",
            add: "Añadir cabecera",
            remove: "Eliminar cabecera",
          },
          editors: {
            label: "Editores",
            placeholder: "Buscar usuarios y grupos",
          },
          users: {
            label: "Usuarios",
            placeholder: "Buscar usuarios y grupos",
          },
          cancel: "Cancelar",
          create: "Crear",
          save: "Guardar",
          delete: "Eliminar",
        },
      },
      mcpServers: {
        title: "Gestión de servidores MCP",
        description: "Gestionar servidores MCP",
        tab: "Servidores MCP",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          name: "Nombre",
          description: "Descripción",
          url: "URL",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
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
              label: "Editar",
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
              label: "Eliminar",
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
            placeholder: "Introduce el nombre del servidor MCP",
          },
          description: {
            label: "Descripción",
            placeholder: "Introduce la descripción del servidor MCP",
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
          editors: {
            label: "Editores",
            placeholder: "Buscar usuarios y grupos",
          },
          users: {
            label: "Usuarios",
            placeholder: "Buscar usuarios y grupos",
          },
          cancel: "Cancelar",
          create: "Crear",
          save: "Guardar",
          delete: "Eliminar",
        },
      },
      skills: {
        title: "Gestión de habilidades",
        description: "Gestionar habilidades para agentes",
        tab: "Habilidades",
        table: {
          filter: "Filtrar",
          search: "Buscar",
          sort: "Ordenar",
          name: "Nombre",
          description: "Descripción",
          actions: {
            title: "Acciones",
            create: {
              label: "Crear",
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
              label: "Editar",
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
              label: "Eliminar",
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
            placeholder: "Introduce el nombre de la habilidad",
          },
          description: {
            label: "Descripción",
            placeholder: "Introduce la descripción de la habilidad",
          },
          parameters: {
            label: "Parámetros",
            name: "Nombre",
            description: "Descripción",
            required: "Requerido",
            add: "Añadir parámetro",
          },
          documentation: {
            label: "Documentación",
            placeholder: "Introduce la documentación",
          },
          code: {
            label: "Código",
            placeholder: "Introduce el código JavaScript",
          },
          editors: {
            label: "Editores",
            placeholder: "Buscar usuarios y grupos",
          },
          users: {
            label: "Usuarios",
            placeholder: "Buscar usuarios y grupos",
          },
          cancel: "Cancelar",
          create: "Crear",
          save: "Guardar",
          delete: "Eliminar",
        },
      },
    },
    error: {
      title: "Error",
      description: "Ocurrió un error",
      back: "Volver a la aplicación",
      message: {
        400: "Solicitud incorrecta",
        401: "No autorizado",
        403: "Prohibido",
        404: "Página no encontrada",
        405: "Método no permitido",
        410: "Ya no disponible",
        429: "Demasiadas solicitudes",
        500: "Error interno del servidor",
      },
    },
  },
  components: {
    agentSelect: {
      label: "Seleccionar agente",
    },
    userMenu: {
      anonymous: {
        label: "Anónimo",
      },
      studio: {
        label: "Studio",
      },
      settings: {
        label: "Configuración",
      },
      language: {
        label: "Idioma",
      },
      theme: {
        label: "Tema",
        value: {
          light: "Claro",
          dark: "Oscuro",
          system: "Sistema",
        },
      },
      logIn: {
        label: "Iniciar sesión",
      },
      logOut: {
        label: "Cerrar sesión",
      },
    },
    users: {
      upsertModal: {
        create: {
          title: "Crear usuario",
          description: "Proporcione los detalles para añadir un nuevo usuario",
        },
        update: {
          title: "Editar usuario",
          description: "Modifique los detalles de un usuario existente",
        },
        form: {
          username: {
            label: "Nombre de usuario",
          },
          fullname: {
            label: "Nombre completo",
          },
          email: {
            label: "Email",
          },
          roles: {
            label: "Roles",
          },
          groups: {
            label: "Grupos",
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
        title: "Eliminar usuario",
        description: "Confirme la eliminación permanente de este usuario",
        form: {
          message: '¿Está seguro de que desea eliminar al usuario "{username}"?',
          delete: {
            label: "Eliminar",
          },
          cancel: {
            label: "Cancelar",
          },
        },
      },
    },
    groups: {
      upsertModal: {
        create: {
          title: "Crear grupo",
          description: "Proporcione los detalles para añadir un nuevo grupo",
        },
        update: {
          title: "Editar grupo",
          description: "Modifique los detalles de un grupo existente",
        },
        form: {
          name: {
            label: "Nombre",
          },
          description: {
            label: "Descripción",
          },
          roles: {
            label: "Roles",
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
        title: "Eliminar grupo",
        description: "Confirme la eliminación permanente de este grupo",
        form: {
          message: '¿Está seguro de que desea eliminar el grupo "{name}"?',
          delete: {
            label: "Eliminar",
          },
          cancel: {
            label: "Cancelar",
          },
        },
      },
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
        description: "Confirme la eliminación permanente de esta sesión de chat",
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
    },
  },
  errors: {
    unexpected: {
      title: "Error inesperado",
      description: "Ocurrió un error inesperado. Por favor, actualice la página.",
    },
  },
}));
