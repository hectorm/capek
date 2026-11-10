export default () => ({
  ai: {
    layouts: {
      default: {
        sidebar: {
          deleteChat: "Delete chat",
        },
      },
    },
    pages: {
      welcome: {
        title: "Welcome",
        description: "Start a conversation",
        newChat: "New chat",
        prompt: {
          enterMessage: "Type your message here...",
        },
        actions: {
          fetchChats: {
            error: {
              title: "Error",
              description: "Failed to load chat sessions",
            },
          },
          createChat: {
            error: {
              title: "Error",
              description: "Failed to create chat session",
            },
          },
          deleteChat: {
            success: {
              title: "Success",
              description: "Chat session deleted successfully",
            },
            error: {
              title: "Error",
              description: "Failed to delete chat session",
            },
          },
        },
      },
      chat: {
        title: "Chat",
        description: "Chat session",
        untitled: "Untitled",
        dateGroups: {
          today: "Today",
          yesterday: "Yesterday",
          lastWeek: "Last 7 days",
          lastMonth: "Last month",
        },
        actions: {
          menu: "Actions menu",
          copy: "Copy",
          edit: "Edit",
          retry: "Retry",
          regenerate: "Regenerate",
          rename: "Rename",
          delete: "Delete",
          fetchChat: {
            error: {
              title: "Error",
              description: "Failed to load chat session",
            },
          },
          sendMessage: {
            error: {
              title: "Error",
              description: "Failed to send message",
            },
          },
          retryMessage: {
            error: {
              title: "Error",
              description: "Failed to retry message",
            },
          },
          regenerateMessage: {
            error: {
              title: "Error",
              description: "Failed to regenerate message",
            },
          },
          deleteMessage: {
            error: {
              title: "Error",
              description: "Failed to delete message",
            },
          },
          editMessage: {
            error: {
              title: "Error",
              description: "Failed to edit message",
            },
          },
          renameSession: {
            success: {
              title: "Success",
              description: "Chat session renamed successfully",
            },
            error: {
              title: "Error",
              description: "Failed to rename chat session",
            },
          },
          updateSession: {
            error: {
              title: "Error",
              description: "Failed to update chat session",
            },
          },
        },
      },
      studio: {
        agents: {
          title: "Agent management",
          description: "Manage AI agents",
          tab: "Agents",
          table: {
            filter: "Filter",
            search: "Search",
            sort: "Sort",
            name: "Name",
            description: "Description",
            type: "Type",
            model: "Model",
            actions: {
              title: "Actions",
              create: {
                label: "Create",
                success: {
                  title: "Success",
                  description: "Agent created successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to create agent",
                },
              },
              update: {
                label: "Edit",
                success: {
                  title: "Success",
                  description: "Agent updated successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to update agent",
                },
              },
              delete: {
                label: "Delete",
                success: {
                  title: "Success",
                  description: "Agent deleted successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to delete agent",
                },
              },
            },
          },
          create: {
            title: "Create agent",
            description: "Create a new AI agent",
          },
          edit: {
            title: "Edit agent",
            description: "Update agent settings",
          },
          delete: {
            title: "Delete agent",
            description: "Confirm permanent removal of this agent",
            confirm: 'Are you sure you want to delete the agent "{name}"?',
          },
          form: {
            name: {
              label: "Name",
              placeholder: "Enter agent name",
            },
            description: {
              label: "Description",
              placeholder: "Enter agent description",
            },
            instructions: {
              label: "Instructions",
              placeholder: "Provide specific instructions for the agent's behavior and responses",
            },
            greetingMessage: {
              label: "Greeting message",
              placeholder: "Message shown to users at the start of a chat session with this agent",
            },
            editors: {
              label: "Editors",
              placeholder: "Search users and groups",
            },
            users: {
              label: "Users",
              placeholder: "Search users and groups",
            },
            type: {
              label: "Type",
              specialist: "Specialist",
              triage: "Triage",
            },
            specialists: {
              label: "Specialists",
              placeholder: "Select specialists (triage only)",
            },
            llmProvider: {
              label: "LLM provider",
              placeholder: "Select an LLM provider",
            },
            model: {
              label: "Model",
              placeholder: "Model to use for this agent",
            },
            summaryModel: {
              label: "Summary model",
              placeholder: "Leave empty to use main model",
            },
            mcpServers: {
              label: "MCP servers",
              placeholder: "Select MCP servers",
              hint: "MCP servers that agents can use during execution",
            },
            skills: {
              label: "Skills",
              placeholder: "Select skills",
              hint: "Skills available to the agent during execution",
            },
            toolProviders: {
              description: "Let the agent use these tools on behalf of the user it answers",
            },
            toolResources: {
              placeholder: "Select resources",
              hint: "Resources whose tools are available to the agent during execution",
            },
            codeInterpreter: {
              label: "Code interpreter",
              description: "Enable code execution for this agent",
            },
            streaming: {
              label: "Streaming",
              description: "Enable streaming responses for this agent",
            },
            advancedSettings: {
              label: "Advanced settings",
              customized: "{count} customized",
              default: "Default: {value}",
            },
            temperature: {
              label: "Temperature",
              hint: "Controls randomness (0 = focused, 2 = creative)",
            },
            maxTokens: {
              label: "Max tokens",
              hint: "Maximum response length",
            },
            topP: {
              label: "Top-p",
              hint: "Limits word choices to the most likely options (lower = more predictable)",
            },
            frequencyPenalty: {
              label: "Frequency penalty",
              hint: "Reduces repetition of tokens",
            },
            presencePenalty: {
              label: "Presence penalty",
              hint: "Encourages new topics",
            },
            maxIterations: {
              label: "Max iterations",
              hint: "Maximum number of tool call iterations per agent execution",
            },
            timeoutSec: {
              label: "Timeout",
              hint: "Maximum execution time in seconds before agent is terminated",
            },
            maxContextChars: {
              label: "Max context characters",
              hint: "Maximum total characters for message context sent to the model",
            },
            maxToolResponseChars: {
              label: "Max tool response characters",
              hint: "Maximum characters for a single tool response before truncation",
            },
            cancel: "Cancel",
            create: "Create",
            save: "Save",
            delete: "Delete",
          },
        },
        llmProviders: {
          title: "LLM provider management",
          description: "Manage LLM providers",
          tab: "LLM providers",
          table: {
            filter: "Filter",
            search: "Search",
            sort: "Sort",
            name: "Name",
            description: "Description",
            apiUrl: "API URL",
            actions: {
              title: "Actions",
              create: {
                label: "Create",
                success: {
                  title: "Success",
                  description: "LLM provider created successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to create LLM provider",
                },
              },
              update: {
                label: "Edit",
                success: {
                  title: "Success",
                  description: "LLM provider updated successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to update LLM provider",
                },
              },
              delete: {
                label: "Delete",
                success: {
                  title: "Success",
                  description: "LLM provider deleted successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to delete LLM provider",
                },
              },
            },
          },
          create: {
            title: "Create LLM provider",
            description: "Add a new LLM provider",
          },
          edit: {
            title: "Edit LLM provider",
            description: "Update LLM provider settings",
          },
          delete: {
            title: "Delete LLM provider",
            description: "Confirm permanent removal of this LLM provider",
            confirm: 'Are you sure you want to delete the LLM provider "{name}"?',
          },
          form: {
            name: {
              label: "Name",
              placeholder: "Enter LLM provider name",
            },
            description: {
              label: "Description",
              placeholder: "Enter LLM provider description",
            },
            apiUrl: {
              label: "API URL",
              placeholder: "https://api.example.com/v1",
            },
            apiType: {
              label: "API type",
              chatCompletions: "Chat Completions",
              responses: "Responses",
            },
            apiKey: {
              label: "API key",
              placeholder: "Enter API key",
            },
            headers: {
              label: "Custom headers",
              namePlaceholder: "Header name",
              valuePlaceholder: "Header value",
              add: "Add header",
              remove: "Remove header",
            },
            editors: {
              label: "Editors",
              placeholder: "Search users and groups",
            },
            users: {
              label: "Users",
              placeholder: "Search users and groups",
            },
            cancel: "Cancel",
            create: "Create",
            save: "Save",
            delete: "Delete",
          },
        },
        mcpServers: {
          title: "MCP server management",
          description: "Manage MCP servers",
          tab: "MCP servers",
          table: {
            filter: "Filter",
            search: "Search",
            sort: "Sort",
            name: "Name",
            description: "Description",
            url: "URL",
            actions: {
              title: "Actions",
              create: {
                label: "Create",
                success: {
                  title: "Success",
                  description: "MCP server created successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to create MCP server",
                },
              },
              update: {
                label: "Edit",
                success: {
                  title: "Success",
                  description: "MCP server updated successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to update MCP server",
                },
              },
              delete: {
                label: "Delete",
                success: {
                  title: "Success",
                  description: "MCP server deleted successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to delete MCP server",
                },
              },
            },
          },
          create: {
            title: "Create MCP server",
            description: "Add a new MCP server",
          },
          edit: {
            title: "Edit MCP server",
            description: "Update MCP server settings",
          },
          delete: {
            title: "Delete MCP server",
            description: "Confirm permanent removal of this MCP server",
            confirm: 'Are you sure you want to delete the MCP server "{name}"?',
          },
          form: {
            name: {
              label: "Name",
              placeholder: "Enter MCP server name",
            },
            description: {
              label: "Description",
              placeholder: "Enter MCP server description",
            },
            url: {
              label: "URL",
              placeholder: "http://example.com/mcp",
            },
            headers: {
              label: "Custom headers",
              namePlaceholder: "Header name",
              valuePlaceholder: "Header value",
              add: "Add header",
              remove: "Remove header",
            },
            stateful: {
              label: "Stateful session",
              description: "Server maintains state across requests",
            },
            advancedSettings: {
              label: "Advanced Settings",
              customized: "{count} customized",
              default: "Default: {value}",
            },
            toolCallTimeoutSec: {
              label: "Tool call timeout",
              hint: "Maximum time in seconds to wait for a tool call response",
            },
            editors: {
              label: "Editors",
              placeholder: "Search users and groups",
            },
            users: {
              label: "Users",
              placeholder: "Search users and groups",
            },
            cancel: "Cancel",
            create: "Create",
            save: "Save",
            delete: "Delete",
          },
        },
        skills: {
          title: "Skills management",
          description: "Manage skills for agents",
          tab: "Skills",
          table: {
            filter: "Filter",
            search: "Search",
            sort: "Sort",
            name: "Name",
            description: "Description",
            actions: {
              title: "Actions",
              create: {
                label: "Create",
                success: {
                  title: "Success",
                  description: "Skill created successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to create skill",
                },
              },
              update: {
                label: "Edit",
                success: {
                  title: "Success",
                  description: "Skill updated successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to update skill",
                },
              },
              delete: {
                label: "Delete",
                success: {
                  title: "Success",
                  description: "Skill deleted successfully",
                },
                error: {
                  title: "Error",
                  description: "Failed to delete skill",
                },
              },
            },
          },
          create: {
            title: "Create skill",
            description: "Add a new skill",
          },
          edit: {
            title: "Edit skill",
            description: "Update skill settings",
          },
          delete: {
            title: "Delete skill",
            description: "Confirm permanent removal of this skill",
            confirm: 'Are you sure you want to delete the skill "{name}"?',
          },
          form: {
            name: {
              label: "Name",
              placeholder: "Enter skill name",
            },
            description: {
              label: "Description",
              placeholder: "Enter skill description",
            },
            parameters: {
              label: "Parameters",
              name: "Name",
              description: "Description",
              required: "Required",
              add: "Add parameter",
            },
            documentation: {
              label: "Documentation",
              placeholder: "Enter documentation",
            },
            code: {
              label: "Code",
              placeholder: "Enter JavaScript code",
            },
            editors: {
              label: "Editors",
              placeholder: "Search users and groups",
            },
            users: {
              label: "Users",
              placeholder: "Search users and groups",
            },
            cancel: "Cancel",
            create: "Create",
            save: "Save",
            delete: "Delete",
          },
        },
      },
      settings: {
        general: {
          categories: {
            welcome: "Welcome page",
          },
          fields: {
            "ai.quickChats": {
              label: "Quick chat prompts",
              description: "Predefined prompts shown on the welcome page.",
              placeholder: "Enter a prompt",
              add: "Add prompt",
              remove: "Remove prompt",
            },
          },
        },
      },
    },
    components: {
      agentSelect: {
        label: "Select agent",
      },
      chat: {
        renameModal: {
          title: "Rename chat session",
          description: "Enter a new title for this chat session",
          form: {
            title: {
              label: "Title",
              placeholder: "Enter chat session title",
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
          title: "Delete chat session",
          description: "Confirm the permanent removal of this chat session",
          form: {
            message: 'Are you sure you want to delete the chat session "{title}"?',
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
  },
});
