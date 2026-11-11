export default () => ({
  layouts: {
    default: {
      description: "Conversational AI platform",
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
            description: "The name displayed in the browser title and navigation.",
            placeholder: "Enter application name",
          },
          "branding.logo": {
            label: "Application logo",
            description: "Full logo displayed in expanded sidebar.",
            placeholder: "Upload image (max. {size} KB)",
          },
          "branding.icon": {
            label: "Application icon",
            description: "Square icon for collapsed sidebar and favicon.",
            placeholder: "Upload image (max. {size} KB)",
          },
          "branding.primaryColor": {
            label: "Primary color",
            description: "Main color used for buttons, links, and important elements.",
            placeholder: "Select a color",
          },
          "branding.neutralColor": {
            label: "Neutral color",
            description: "Color used for text, borders, and backgrounds.",
            placeholder: "Select a color",
          },
          "branding.radius": {
            label: "Border radius",
            description: "Roundness of component corners.",
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
          filter: "Filter",
          search: "Search",
          sort: "Sort",
          username: "Username",
          fullname: "Full name",
          email: "Email",
          roles: "Roles",
          groups: "Groups",
          actions: {
            title: "Actions",
            create: {
              label: "Create",
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
              label: "Edit",
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
              label: "Delete",
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
        },
      },
      groups: {
        title: "Group management",
        description: "Manage groups and assign roles",
        tab: "Groups",
        table: {
          filter: "Filter",
          search: "Search",
          sort: "Sort",
          name: "Name",
          description: "Description",
          roles: "Roles",
          actions: {
            title: "Actions",
            create: {
              label: "Create",
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
              label: "Edit",
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
              label: "Delete",
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
          description: "Provide details to add a new user",
        },
        update: {
          title: "Edit user",
          description: "Modify the details of an existing user",
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
      deleteModal: {
        title: "Delete user",
        description: "Confirm the permanent removal of this user",
        form: {
          message: 'Are you sure you want to delete the user "{username}"?',
          delete: {
            label: "Delete",
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
          description: "Provide details to add a new group",
        },
        update: {
          title: "Edit group",
          description: "Modify the details of an existing group",
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
      deleteModal: {
        title: "Delete group",
        description: "Confirm the permanent removal of this group",
        form: {
          message: 'Are you sure you want to delete the group "{name}"?',
          delete: {
            label: "Delete",
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
