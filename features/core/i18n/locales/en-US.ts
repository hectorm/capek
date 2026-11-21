export default () => ({
  layouts: {
    default: {
      description: "Application workspace",
      sidebar: {
        title: "Menu",
        description: "Navigation menu",
        toggle: "Toggle sidebar",
        label: "Sidebar",
        homeLink: "Go to home",
      },
    },
  },
  pages: {
    home: {
      title: "Home",
      description: "Welcome",
    },
    studio: {
      title: "Studio",
      description: "Create and manage resources",
    },
    settings: {
      title: "Settings",
      description: "Application settings",
      general: {
        title: "General settings",
        description: "Adjust general preferences",
        tab: "General",
        categories: {
          branding: "Branding",
        },
        fields: {
          "branding.name": {
            label: "Application name",
            description: "The name displayed in the browser title and navigation",
            placeholder: "Enter application name",
          },
          "branding.logo": {
            label: "Application logo",
            description: "Full logo displayed in expanded sidebar",
            placeholder: "Upload image (max. {size} KB)",
          },
          "branding.icon": {
            label: "Application icon",
            description: "Square icon for collapsed sidebar and favicon",
            placeholder: "Upload image (max. {size} KB)",
          },
          "branding.primaryColor": {
            label: "Primary color",
            description: "Main color used for buttons, links, and important elements",
            placeholder: "Select a color",
          },
          "branding.neutralColor": {
            label: "Neutral color",
            description: "Color used for text, borders, and backgrounds",
            placeholder: "Select a color",
          },
          "branding.radius": {
            label: "Border radius",
            description: "Roundness of component corners",
            placeholder: "Select border radius",
          },
        },
        actions: {
          save: "Save",
          reset: "Reset to default",
          usingDefault: "Using default value",
          overridden: "Custom value set",
        },
        messages: {
          loading: "Loading settings...",
          fetchError: {
            title: "Error",
            description: "Failed to load settings",
          },
          saveSuccess: {
            title: "Success",
            description: "Settings saved successfully",
          },
          saveError: {
            title: "Error",
            description: "Failed to save settings",
          },
          resetSuccess: {
            title: "Success",
            description: "Setting reset to default",
          },
          resetError: {
            title: "Error",
            description: "Failed to reset setting",
          },
          fileTooLarge: {
            title: "File too large",
            description: "File size exceeds the maximum allowed size of {maxSize} KB",
          },
          invalidFileType: {
            title: "Invalid file type",
            description: "File type must be one of: {accept}",
          },
          fileReadError: {
            title: "File read error",
            description: "Failed to read the selected file",
          },
        },
      },
      users: {
        title: "User management",
        description: "Manage users and assign roles",
        tab: "Users",
        table: {
          username: "Username",
          fullname: "Full name",
          email: "Email",
          roles: "Roles",
          groups: "Groups",
        },
        actions: {
          create: {
            success: {
              title: "Success",
              description: "User created successfully",
            },
            error: {
              title: "Error",
              description: "Failed to create user",
            },
          },
          update: {
            success: {
              title: "Success",
              description: "User updated successfully",
            },
            error: {
              title: "Error",
              description: "Failed to update user",
            },
          },
          delete: {
            success: {
              title: "Success",
              description: "User deleted successfully",
            },
            error: {
              title: "Error",
              description: "Failed to delete user",
            },
          },
        },
        delete: {
          title: "Delete user",
          description: "Confirm the permanent removal of this user",
          confirm: 'Are you sure you want to delete the user "{name}"?',
        },
      },
      groups: {
        title: "Group management",
        description: "Manage groups and assign roles",
        tab: "Groups",
        table: {
          name: "Name",
          description: "Description",
          roles: "Roles",
        },
        actions: {
          create: {
            success: {
              title: "Success",
              description: "Group created successfully",
            },
            error: {
              title: "Error",
              description: "Failed to create group",
            },
          },
          update: {
            success: {
              title: "Success",
              description: "Group updated successfully",
            },
            error: {
              title: "Error",
              description: "Failed to update group",
            },
          },
          delete: {
            success: {
              title: "Success",
              description: "Group deleted successfully",
            },
            error: {
              title: "Error",
              description: "Failed to delete group",
            },
          },
        },
        delete: {
          title: "Delete group",
          description: "Confirm the permanent removal of this group",
          confirm: 'Are you sure you want to delete the group "{name}"?',
        },
      },
    },
    error: {
      title: "Error",
      description: "An error occurred",
      back: "Back to app",
      message: {
        400: "Bad request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Page not found",
        405: "Method not allowed",
        410: "No longer available",
        429: "Too many requests",
        500: "Internal server error",
      },
    },
  },
  components: {
    accessFields: {
      editors: {
        label: "Editors",
        placeholder: "Search users and groups",
      },
      users: {
        label: "Users",
        placeholder: "Search users and groups",
      },
    },
    resource: {
      cancel: "Cancel",
      delete: "Delete",
      deleteConflict: "Transfer ownership or remove references, then try again",
      empty: "There is nothing to show",
      loadError: "Failed to load the data",
      noMatches: "No results match the filter",
      retry: "Retry",
      update: "Edit",
    },
    collectionLayoutToggle: {
      layout: "Collection layout",
      listView: "List view",
      gridView: "Grid view",
    },
    resourceTable: {
      actions: "Actions",
      create: "Create",
      filter: "Filter by {column}",
      loadError: "Failed to load the rows",
      search: "Search",
      sort: "Sort by {column}",
    },
    userMenu: {
      anonymous: {
        label: "Anonymous",
      },
      studio: {
        label: "Studio",
      },
      settings: {
        label: "Settings",
      },
      language: {
        label: "Language",
      },
      theme: {
        label: "Theme",
        value: {
          light: "Light",
          dark: "Dark",
          system: "System",
        },
      },
      logIn: {
        label: "Log in",
      },
      logOut: {
        label: "Log out",
      },
    },
    users: {
      upsertModal: {
        create: {
          title: "Create user",
          description: "Add a new user",
        },
        update: {
          title: "Edit user",
          description: "Update user details",
        },
        form: {
          username: {
            label: "Username",
          },
          fullname: {
            label: "Full name",
          },
          email: {
            label: "Email",
          },
          roles: {
            label: "Roles",
          },
          groups: {
            label: "Groups",
          },
          save: {
            label: "Save",
          },
          cancel: {
            label: "Cancel",
          },
        },
      },
    },
    groups: {
      upsertModal: {
        create: {
          title: "Create group",
          description: "Add a new group",
        },
        update: {
          title: "Edit group",
          description: "Update group details",
        },
        form: {
          name: {
            label: "Name",
          },
          description: {
            label: "Description",
          },
          roles: {
            label: "Roles",
          },
          save: {
            label: "Save",
          },
          cancel: {
            label: "Cancel",
          },
        },
      },
    },
  },
  errors: {
    secretRequired: "The connection has changed, enter this value again",
    unexpected: {
      title: "Unexpected error",
      description: "An unexpected error occurred. Please refresh the page.",
    },
  },
});
