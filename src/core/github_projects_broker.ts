import { GraphQLClient } from './graphql_client';
import {
  LIST_USER_PROJECTS,
  LIST_ORG_PROJECTS,
  GET_PROJECT_FIELDS,
  GET_PROJECT_ITEMS,
  CREATE_PROJECT,
  CREATE_DRAFT_ISSUE,
  ADD_ITEM_TO_PROJECT,
  UPDATE_ITEM_FIELD_SINGLE_SELECT,
  UPDATE_ITEM_FIELD_NUMBER,
  CLEAR_ITEM_FIELD,
  GET_NODE_ID,
  GET_USER_ID,
  GET_ORG_ID,
  CREATE_PROJECT_FIELD,
  ADD_PROJECT_FIELD_OPTION,
} from './graphql_queries';
import {
  AuthConfig,
  AgilePlan,
  ApplyToProjectOptions,
  ApplyToProjectResult,
  ProjectInfo,
  ProjectField,
  ProjectItem,
  CustomSingleSelectOption,
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

interface CreateDraftIssueResponse {
  addProjectV2DraftIssue: { projectItem: { id: string } };
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

interface GetNodeIdResponse {
  repository: { id: string } | null;
}

interface CreateProjectFieldResponse {
  createProjectV2Field: {
    projectV2Field: {
      id: string;
      name: string;
      options: Array<{ id: string; name: string; color: string }>;
    };
  };
}

interface AddProjectFieldOptionResponse {
  addProjectV2SingleSelectFieldOption: {
    field: {
      id: string;
      name: string;
      options: Array<{ id: string; name: string; color: string }>;
    };
  };
}


const FIELD_NAME_MAP: Record<string, string> = {
  priority: 'Priority',
  risk_level: 'Risk',
  story_points: 'Story Points',
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

  async createDraftIssue(title: string, body?: string): Promise<string> {
    const data = await this.graphql.query<CreateDraftIssueResponse>(CREATE_DRAFT_ISSUE, {
      variables: { projectId: this.projectId, title, body: body ?? null },
    });
    return data.addProjectV2DraftIssue.projectItem.id;
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

  async createCustomSingleSelectField(
    projectId: string,
    fieldName: string,
    options: CustomSingleSelectOption[],
  ): Promise<{ id: string; name: string; options: Array<{ id: string; name: string; color: string }> }> {
    const formattedOptions = options.map((opt) => {
      let color = opt.color.toUpperCase();
      const validColors = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];
      if (!validColors.includes(color)) {
        color = 'GRAY';
      }
      return {
        name: opt.name,
        color,
        ...(opt.description ? { description: opt.description } : {}),
      };
    });

    const data = await this.graphql.query<CreateProjectFieldResponse>(CREATE_PROJECT_FIELD, {
      variables: {
        projectId,
        name: fieldName,
        dataType: 'SINGLE_SELECT',
        singleSelectOptions: formattedOptions,
      },
    });

    return data.createProjectV2Field.projectV2Field;
  }

  async addProjectSingleSelectOption(
    fieldId: string,
    name: string,
    color: string,
  ): Promise<{ id: string; name: string; options: Array<{ id: string; name: string; color: string }> }> {
    let formattedColor = color.toUpperCase();
    const validColors = ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'];
    if (!validColors.includes(formattedColor)) {
      formattedColor = 'GRAY';
    }

    const data = await this.graphql.query<AddProjectFieldOptionResponse>(ADD_PROJECT_FIELD_OPTION, {
      variables: {
        fieldId,
        name,
        color: formattedColor,
      },
    });

    return data.addProjectV2SingleSelectFieldOption.field;
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
      const priorityField = fieldMap.get(FIELD_NAME_MAP.priority);
      const riskField = fieldMap.get(FIELD_NAME_MAP.risk_level);
      const storyPointsField = fieldMap.get(FIELD_NAME_MAP.story_points);

      const typeStoryOption = typeField?.options?.find(
        (o) => o.name.toLowerCase() === 'feature' || o.name.toLowerCase() === 'story'
      );
      const typeTaskOption = typeField?.options?.find((o) => o.name.toLowerCase() === 'task');

      const priorityOptions = new Map(
        (priorityField?.options ?? []).map((o) => [o.name.toUpperCase(), o.id]),
      );
      const riskOptions = new Map(
        (riskField?.options ?? []).map((o) => [o.name.toUpperCase(), o.id]),
      );

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
          if (options.createAsDraftIssues) {
            storyItemId = await this.createDraftIssue(storyTitle, story.description);
          } else {
            const nodeIssueId = issueNodeIdMap?.[story.id];
            if (!nodeIssueId) {
              throw new Error(`No node ID mapped for story ${story.id}. When createAsDraftIssues=false, issueNodeIdMap is required.`);
            }
            storyItemId = await this.addIssueToProject(nodeIssueId);
          }

          createdItems.push({ id: storyItemId, title: storyTitle });

          if (typeStoryOption) {
            await this.updateItemFieldSingleSelect(storyItemId, typeField!.id, typeStoryOption.id);
          }

          const priorityOptionId = priorityOptions.get(story.priority);
          if (priorityOptionId && priorityField) {
            await this.updateItemFieldSingleSelect(storyItemId, priorityField.id, priorityOptionId);
          }

          const riskOptionId = riskOptions.get(story.risk_level);
          if (riskOptionId && riskField) {
            await this.updateItemFieldSingleSelect(storyItemId, riskField.id, riskOptionId);
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

          let taskItemId: string;
          if (options.createAsDraftIssues) {
            taskItemId = await this.createDraftIssue(taskTitle, task.description);
          } else {
            const nodeTaskId = issueNodeIdMap?.[task.id];
            if (!nodeTaskId) {
              throw new Error(`No node ID mapped for task ${task.id}. When createAsDraftIssues=false, issueNodeIdMap is required.`);
            }
            taskItemId = await this.addIssueToProject(nodeTaskId);
          }

          createdItems.push({ id: taskItemId, title: taskTitle });

          if (typeTaskOption) {
            await this.updateItemFieldSingleSelect(taskItemId, typeField!.id, typeTaskOption.id);
          }

          const taskPriorityOptionId = priorityOptions.get(task.priority.toUpperCase());
          if (taskPriorityOptionId && priorityField) {
            await this.updateItemFieldSingleSelect(taskItemId, priorityField.id, taskPriorityOptionId);
          }

          if (task.story_points !== undefined && storyPointsField) {
            await this.updateItemFieldNumber(taskItemId, storyPointsField.id, task.story_points);
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
      report += `* **Type:** Story\n`;
      report += `* **Priority:** ${story.priority}\n`;
      report += `* **Risk:** ${story.risk_level}\n`;
      report += `* **Description:** ${story.description}\n`;
      report += `* **Tasks:**\n`;
      for (const task of story.tasks) {
        report += `  - \`[${task.id}] ${task.title}\` (Priority: ${task.priority}, Story Points: ${task.story_points ?? 'N/A'})\n`;
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
