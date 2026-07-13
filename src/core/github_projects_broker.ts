import { GraphQLClient } from './graphql_client';
import {
  LIST_USER_PROJECTS,
  LIST_ORG_PROJECTS,
  GET_PROJECT_FIELDS,
  GET_PROJECT_ITEMS,
  CREATE_PROJECT,
  ADD_ITEM_TO_PROJECT,
  UPDATE_ITEM_FIELD_SINGLE_SELECT,
  UPDATE_ITEM_FIELD_NUMBER,
  CLEAR_ITEM_FIELD,
  DELETE_PROJECT_ITEM,
  GET_NODE_ID,
  GET_USER_ID,
  GET_ORG_ID,
} from './graphql_queries';
import {
  AuthConfig,
  AgilePlan,
  ApplyToProjectOptions,
  ApplyToProjectResult,
  ProjectInfo,
  ProjectField,
  ProjectItem,
} from './types';

interface ListProjectsResponse {
  user: { projectsV2: { nodes: ProjectInfo[] } } | null;
  organization: { projectsV2: { nodes: ProjectInfo[] } } | null;
}

interface GetProjectFieldsResponse {
  node: {
    title: string;
    number: number;
    fields: { nodes: Array<{
      id: string;
      name: string;
      dataType?: string;
      options?: Array<{ id: string; name: string }>;
    }> };
  } | null;
}

interface GetProjectItemsResponse {
  node: {
    title: string;
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      nodes: Array<{
        id: string;
        type: string;
        content: {
          id: string;
          title: string;
          number?: number;
          url?: string;
        } | null;
        fieldValues: {
          nodes: Array<{
            name?: string;
            number?: number;
            text?: string;
            field: { name: string; id: string } | null;
          }>;
        };
      }>;
    };
  } | null;
}

interface AddItemResponse {
  addProjectV2ItemById: { item: { id: string } };
}

interface CreateProjectResponse {
  createProjectV2: { projectV2: ProjectInfo };
}

interface GetOwnerIdResponse {
  user: { id: string } | null;
  organization: { id: string } | null;
}

interface UpdateFieldResponse {
  updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
}

interface DeleteProjectItemResponse {
  deleteProjectV2Item: { deletedItemId: string };
}

interface GetNodeIdResponse {
  repository: { id: string } | null;
}

const FIELD_NAME_MAP: Record<string, string> = {
  type: 'Type',
  status: 'Status',
};

export class GitHubProjectsBroker {
  private readonly graphql: GraphQLClient;
  private readonly projectId: string;

  constructor(auth: AuthConfig, projectId: string) {
    this.graphql = new GraphQLClient(auth);
    this.projectId = projectId;
  }

  async listProjects(ownerLogin: string, isOrg: boolean = false): Promise<ProjectInfo[]> {
    const query = isOrg ? LIST_ORG_PROJECTS : LIST_USER_PROJECTS;
    const data = await this.graphql.query<ListProjectsResponse>(query, {
      variables: { login: ownerLogin, first: 100 },
    });

    if (isOrg) {
      return data.organization?.projectsV2.nodes ?? [];
    }
    return data.user?.projectsV2.nodes ?? [];
  }

  async getProjectFields(): Promise<ProjectField[]> {
    const data = await this.graphql.query<GetProjectFieldsResponse>(GET_PROJECT_FIELDS, {
      variables: { projectId: this.projectId },
    });

    if (!data.node) {
      throw new Error(`Project not found: ${this.projectId}`);
    }

    return data.node.fields.nodes.map((f) => ({
      id: f.id,
      name: f.name,
      dataType: f.dataType ?? 'UNKNOWN',
      options: f.options,
    }));
  }

  async getProjectItems(): Promise<ProjectItem[]> {
    const items: ProjectItem[] = [];
    let cursor: string | undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const data = await this.graphql.query<GetProjectItemsResponse>(GET_PROJECT_ITEMS, {
        variables: { projectId: this.projectId, first: 50, after: cursor ?? null },
      });

      if (!data.node) {
        throw new Error(`Project not found: ${this.projectId}`);
      }

      for (const node of data.node.items.nodes) {
        const fieldValues: Record<string, string | number> = {};
        for (const fv of node.fieldValues.nodes) {
          if (fv.field) {
            const value = fv.name ?? fv.number ?? fv.text;
            if (value !== undefined && value !== null) {
              fieldValues[fv.field.name] = value;
            }
          }
        }

        items.push({
          id: node.id,
          type: node.type as ProjectItem['type'],
          content: node.content,
          fieldValues,
        });
      }

      hasNextPage = data.node.items.pageInfo.hasNextPage;
      cursor = data.node.items.pageInfo.endCursor;
    }

    return items;
  }

  async addIssueToProject(issueNodeId: string): Promise<string> {
    const data = await this.graphql.query<AddItemResponse>(ADD_ITEM_TO_PROJECT, {
      variables: { projectId: this.projectId, contentId: issueNodeId },
    });
    return data.addProjectV2ItemById.item.id;
  }

  async updateItemFieldSingleSelect(itemId: string, fieldId: string, optionId: string): Promise<void> {
    await this.graphql.query<UpdateFieldResponse>(UPDATE_ITEM_FIELD_SINGLE_SELECT, {
      variables: { projectId: this.projectId, itemId, fieldId, optionId },
    });
  }

  async updateItemFieldNumber(itemId: string, fieldId: string, value: number): Promise<void> {
    await this.graphql.query<UpdateFieldResponse>(UPDATE_ITEM_FIELD_NUMBER, {
      variables: { projectId: this.projectId, itemId, fieldId, value },
    });
  }

  async clearItemField(itemId: string, fieldId: string): Promise<void> {
    await this.graphql.query(CLEAR_ITEM_FIELD, {
      variables: { projectId: this.projectId, itemId, fieldId },
    });
  }

  async deleteProjectItem(itemId: string): Promise<void> {
    await this.graphql.query<DeleteProjectItemResponse>(DELETE_PROJECT_ITEM, {
      variables: { projectId: this.projectId, itemId },
    });
  }

  async getRepositoryNodeId(owner: string, repo: string): Promise<string> {
    const data = await this.graphql.query<GetNodeIdResponse>(GET_NODE_ID, {
      variables: { owner, repo },
    });
    if (!data.repository) {
      throw new Error(`Repository not found: ${owner}/${repo}`);
    }
    return data.repository.id;
  }

  async getOwnerId(login: string): Promise<{ id: string; type: 'USER' | 'ORGANIZATION' }> {
    try {
      const userData = await this.graphql.query<GetOwnerIdResponse>(GET_USER_ID, {
        variables: { login },
      });
      if (userData.user) {
        return { id: userData.user.id, type: 'USER' };
      }
    } catch {
      // Not a user, try organization
    }

    const orgData = await this.graphql.query<GetOwnerIdResponse>(GET_ORG_ID, {
      variables: { login },
    });
    if (orgData.organization) {
      return { id: orgData.organization.id, type: 'ORGANIZATION' };
    }

    throw new Error(`User or organization not found: ${login}`);
  }

  async createProject(ownerId: string, title: string): Promise<ProjectInfo> {
    const data = await this.graphql.query<CreateProjectResponse>(CREATE_PROJECT, {
      variables: { ownerId, title },
    });
    return data.createProjectV2.projectV2;
  }

  async applyPlanToProject(
    plan: AgilePlan,
    options: ApplyToProjectOptions,
    issueNodeIdMap?: Record<string, string>,
  ): Promise<ApplyToProjectResult> {
    try {
      if (options.dryRun) {
        return this.generateDryRunReport(plan);
      }

      const fields = await this.getProjectFields();
      const fieldMap = new Map(fields.map((f) => [f.name, f]));

      const existingItems = options.idempotent ? await this.getProjectItems() : [];

      const createdItems: Array<{ id: string; title: string }> = [];
      const reusedItems: Array<{ id: string; title: string }> = [];

      const typeField = fieldMap.get(FIELD_NAME_MAP.type);

      const typeStoryOption = typeField?.options?.find(
        (o) => o.name.toLowerCase() === 'feature' || o.name.toLowerCase() === 'story'
      );
      const typeTaskOption = typeField?.options?.find((o) => o.name.toLowerCase() === 'task');

      for (const story of plan.epic.stories) {
        const storyTitle = `[${story.id}] ${story.title}`;
        let storyItemId: string | null = null;

        if (options.idempotent) {
          const existing = existingItems.find(
            (i) => i.content?.title === storyTitle || i.content?.title === story.title,
          );
          if (existing) {
            reusedItems.push({ id: existing.id, title: storyTitle });
            storyItemId = existing.id;
          }
        }

        if (!storyItemId) {
          const nodeIssueId = issueNodeIdMap?.[story.id];
          if (!nodeIssueId) {
            throw new Error(`No node ID mapped for story ${story.id}. issueNodeIdMap is required.`);
          }
          storyItemId = await this.addIssueToProject(nodeIssueId);

          createdItems.push({ id: storyItemId, title: storyTitle });

          if (typeStoryOption) {
            await this.updateItemFieldSingleSelect(storyItemId, typeField!.id, typeStoryOption.id);
          }
        }

        for (const task of story.tasks) {
          const taskTitle = `[${task.id}] ${task.title}`;

          if (options.idempotent) {
            const existing = existingItems.find(
              (i) => i.content?.title === taskTitle || i.content?.title === task.title,
            );
            if (existing) {
              reusedItems.push({ id: existing.id, title: taskTitle });
              continue;
            }
          }

          const nodeTaskId = issueNodeIdMap?.[task.id];
          if (!nodeTaskId) {
            throw new Error(`No node ID mapped for task ${task.id}. issueNodeIdMap is required.`);
          }
          const taskItemId = await this.addIssueToProject(nodeTaskId);

          createdItems.push({ id: taskItemId, title: taskTitle });

          if (typeTaskOption) {
            await this.updateItemFieldSingleSelect(taskItemId, typeField!.id, typeTaskOption.id);
          }
        }
      }

      const parts: string[] = [`Plan applied to project.`];
      if (createdItems.length > 0) {
        parts.push(`Created ${createdItems.length} items.`);
      }
      if (reusedItems.length > 0) {
        parts.push(`Reused ${reusedItems.length} existing items.`);
      }

      return {
        success: true,
        message: parts.join(' '),
        createdItems,
        reusedItems,
      };
    } catch (error) {
      const err = error as Error;
      return {
        success: false,
        message: 'Error applying plan to project.',
        createdItems: [],
        reusedItems: [],
        error: err.message,
      };
    }
  }

  private generateDryRunReport(plan: AgilePlan): ApplyToProjectResult {
    let report = `# Simulation Report (Dry Run) - Agile Plan for GitHub Project\n\n`;
    report += `The following items will be created in the project:\n\n`;

    report += `## User Stories\n`;
    for (const story of plan.epic.stories) {
      report += `### \`[${story.id}] ${story.title}\`\n`;
      report += `* **Type:** Feature\n`;
      report += `* **Description:** ${story.description}\n`;
      report += `* **Tasks:**\n`;
      for (const task of story.tasks) {
        report += `  - \`[${task.id}] ${task.title}\`\n`;
      }
      report += `\n`;
    }

    return {
      success: true,
      message: 'Simulation completed successfully. No changes were made.',
      createdItems: [],
      reusedItems: [],
      report,
    };
  }
}
