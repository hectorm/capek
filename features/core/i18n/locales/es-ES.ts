import type enUS from "./en-US";

export default (): ReturnType<typeof enUS> => ({
  layouts: {
    default: {
      description: "Área de trabajo de la aplicación",
      sidebar: {
        title: "Menú",
        description: "Menú de navegación",
        toggle: "Mostrar u ocultar la barra lateral",
        label: "Barra lateral",
        homeLink: "Ir al inicio",
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
            description: "Nombre que se muestra en el título del navegador y en la navegación",
            placeholder: "Introduzca el nombre de la aplicación",
          },
          "branding.logo": {
            label: "Logotipo de la aplicación",
            description: "Logotipo completo que se muestra en la barra lateral expandida",
            placeholder: "Subir imagen (máx. {size} KB)",
          },
          "branding.icon": {
            label: "Icono de la aplicación",
            description: "Icono cuadrado para la barra lateral contraída y el favicon",
            placeholder: "Subir imagen (máx. {size} KB)",
          },
          "branding.primaryColor": {
            label: "Color primario",
            description: "Color principal utilizado para botones, enlaces y elementos importantes",
            placeholder: "Seleccione un color",
          },
          "branding.neutralColor": {
            label: "Color neutro",
            description: "Color utilizado para texto, bordes y fondos",
            placeholder: "Seleccione un color",
          },
          "branding.radius": {
            label: "Radio de borde",
            description: "Redondeo de las esquinas de los componentes",
            placeholder: "Seleccione un radio de borde",
          },
        },
        actions: {
          save: "Guardar",
          reset: "Restablecer valor predeterminado",
          usingDefault: "Se usa el valor predeterminado",
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
            description: "Ajuste restablecido al valor predeterminado",
          },
          resetError: {
            title: "Error",
            description: "Error al restablecer el ajuste",
          },
          fileTooLarge: {
            title: "Archivo demasiado grande",
            description: "El tamaño del archivo supera el tamaño máximo permitido de {maxSize} KB",
          },
          invalidFileType: {
            title: "Tipo de archivo no válido",
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
          username: "Nombre de usuario",
          fullname: "Nombre completo",
          email: "Correo electrónico",
          roles: "Roles",
          groups: "Grupos",
        },
        actions: {
          create: {
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
        create: {
          title: "Crear usuario",
          description: "Añadir un nuevo usuario",
        },
        edit: {
          title: "Editar usuario",
          description: "Actualizar los datos del usuario",
        },
        delete: {
          title: "Eliminar usuario",
          description: "Confirmar la eliminación permanente de este usuario",
          confirm: '¿Está seguro de que desea eliminar al usuario "{name}"?',
        },
        form: {
          username: {
            label: "Nombre de usuario",
          },
          fullname: {
            label: "Nombre completo",
          },
          email: {
            label: "Correo electrónico",
          },
          roles: {
            label: "Roles",
          },
          groups: {
            label: "Grupos",
          },
          save: "Guardar",
          cancel: "Cancelar",
        },
      },
      groups: {
        title: "Gestión de grupos",
        description: "Gestionar grupos y asignar roles",
        tab: "Grupos",
        table: {
          name: "Nombre",
          description: "Descripción",
          roles: "Roles",
        },
        actions: {
          create: {
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
        create: {
          title: "Crear grupo",
          description: "Añadir un nuevo grupo",
        },
        edit: {
          title: "Editar grupo",
          description: "Actualizar los datos del grupo",
        },
        delete: {
          title: "Eliminar grupo",
          description: "Confirmar la eliminación permanente de este grupo",
          confirm: '¿Está seguro de que desea eliminar el grupo "{name}"?',
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
          save: "Guardar",
          cancel: "Cancelar",
        },
      },
    },
    error: {
      title: "Error",
      description: "Se ha producido un error",
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
    accessFields: {
      editors: {
        label: "Editores",
        placeholder: "Buscar usuarios y grupos",
      },
      users: {
        label: "Usuarios",
        placeholder: "Buscar usuarios y grupos",
      },
    },
    resource: {
      cancel: "Cancelar",
      delete: "Eliminar",
      deleteConflict: "Transfiera la propiedad o elimine las referencias y vuelva a intentarlo",
      empty: "No hay nada que mostrar",
      loadError: "Error al cargar los datos",
      noMatches: "Ningún resultado coincide con el filtro",
      retry: "Reintentar",
      update: "Editar",
    },
    confirmDeleteModal: {
      form: {
        name: {
          label: 'Escriba "{name}" para confirmar',
          mismatch: "El nombre no coincide",
        },
      },
    },
    collectionLayoutToggle: {
      layout: "Diseño de la colección",
      listView: "Vista de lista",
      gridView: "Vista de cuadrícula",
    },
    resourceTable: {
      actions: "Acciones",
      create: "Crear",
      filter: "Filtrar por {column}",
      loadError: "Error al cargar las filas",
      search: "Buscar",
      sort: "Ordenar por {column}",
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
  },
  errors: {
    secretRequired: "La conexión ha cambiado. Vuelva a introducir este valor.",
    unexpected: {
      title: "Error inesperado",
      description: "Se ha producido un error inesperado. Por favor, actualice la página.",
    },
  },
});
