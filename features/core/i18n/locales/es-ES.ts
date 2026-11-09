import type enUS from "./en-US";

export default (): ReturnType<typeof enUS> => ({
  layouts: {
    default: {
      title: "Capek",
      description: "Plataforma de IA conversacional",
      sidebar: {
        title: "Menú",
        description: "Menú de navegación",
        toggle: "Alternar menú lateral",
        label: "Barra lateral",
        homeLink: "Ir a inicio",
      },
    },
  },
  pages: {
    home: {
      title: "Inicio",
      description: "Bienvenido/a",
    },
    studio: {
      title: "Studio",
      description: "Crear y gestionar recursos",
    },
    settings: {
      title: "Configuración",
      description: "Configuración de la aplicación",
      general: {
        title: "Configuración general",
        description: "Ajustar preferencias generales",
        tab: "General",
        categories: {
          branding: "Marca",
        },
        fields: {
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
  },
  errors: {
    unexpected: {
      title: "Error inesperado",
      description: "Ocurrió un error inesperado. Por favor, actualice la página.",
    },
  },
});
