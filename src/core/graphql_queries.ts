// GitHub Projects V2 GraphQL Queries & Mutations
// Endpoint: https://api.github.com/graphql
// Requires scope: "project" (read/write), "read:project" (read-only)

// ---------------------------------------------------------------------------
// QUERIES
// ---------------------------------------------------------------------------

export const LIST_USER_PROJECTS = `
  query ListUserProjects($login: String!, $first: Int!) {
    user(login: $login) {
      projectsV2(first: $first) {
        nodes { id title number shortDescription closed }
      }
    }
  }
`;

export const LIST_ORG_PROJECTS = `
  query ListOrgProjects($login: String!, $first: Int!) {
    organization(login: $login) {
      projectsV2(first: $first) {
        nodes { id title number shortDescription closed }
      }
    }
  }
`;

export const GET_PROJECT_FIELDS = `
  query GetProjectFields($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        title
        number
        fields(first: 100) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
            ... on ProjectV2Field {
              id
              name
              dataType
            }
            ... on ProjectV2IterationField {
              id
              name
              configuration {
                iterations {
                  id
                  startDate
                  title
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_PROJECT_ITEMS = `
  query GetProjectItems($projectId: ID!, $first: Int!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        title
        items(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            type
            content {
              ... on Issue {
                id
                title
                number
                url
              }
              ... on PullRequest {
                id
                title
                number
                url
              }
              ... on DraftIssue {
                id
                title
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField {
                      name
                      id
                    }
                  }
                }
                ... on ProjectV2ItemFieldNumberValue {
                  number
                  field {
                    ... on ProjectV2Field {
                      name
                      id
                    }
                  }
                }
                ... on ProjectV2ItemFieldTextValue {
                  text
                  field {
                    ... on ProjectV2Field {
                      name
                      id
                    }
                  }
                }
                ... on ProjectV2ItemFieldDateValue {
                  date
                  field {
                    ... on ProjectV2Field {
                      name
                      id
                    }
                  }
                }
                ... on ProjectV2ItemFieldLabelValue {
                  labels(first: 20) {
                    nodes { name color }
                  }
                  field {
                    ... on ProjectV2Field {
                      name
                      id
                    }
                  }
                }
                ... on ProjectV2ItemFieldIterationValue {
                  title
                  startDate
                  field {
                    ... on ProjectV2IterationField {
                      name
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// MUTATIONS
// ---------------------------------------------------------------------------

export const CREATE_PROJECT = `
  mutation CreateProject($ownerId: ID!, $title: String!) {
    createProjectV2(input: { ownerId: $ownerId, title: $title }) {
      projectV2 { id number title url }
    }
  }
`;

export const CREATE_DRAFT_ISSUE = `
  mutation CreateDraftIssue($projectId: ID!, $title: String!, $body: String) {
    addProjectV2DraftIssue(input: { projectId: $projectId, title: $title, body: $body }) {
      projectItem { id }
    }
  }
`;

export const ADD_ITEM_TO_PROJECT = `
  mutation AddItemToProject($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

export const UPDATE_ITEM_FIELD_SINGLE_SELECT = `
  mutation UpdateSingleSelect($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: ID!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
    ) {
      projectV2Item { id }
    }
  }
`;

export const UPDATE_ITEM_FIELD_NUMBER = `
  mutation UpdateNumber($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { number: $value } }
    ) {
      projectV2Item { id }
    }
  }
`;

export const UPDATE_ITEM_FIELD_TEXT = `
  mutation UpdateText($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { text: $value } }
    ) {
      projectV2Item { id }
    }
  }
`;

export const UPDATE_ITEM_FIELD_DATE = `
  mutation UpdateDate($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Date!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { date: $value } }
    ) {
      projectV2Item { id }
    }
  }
`;

export const UPDATE_ITEM_FIELD_LABELS = `
  mutation UpdateLabels($projectId: ID!, $itemId: ID!, $fieldId: ID!, $labelIds: [ID!]!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { labelIds: $labelIds } }
    ) {
      projectV2Item { id }
    }
  }
`;

export const CLEAR_ITEM_FIELD = `
  mutation ClearField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
    clearProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }
    ) {
      projectV2Item { id }
    }
  }
`;

export const ARCHIVE_ITEM = `
  mutation ArchiveItem($projectId: ID!, $itemId: ID!) {
    archiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
      item { id }
    }
  }
`;

export const APPLY_PROJECT_V2_TEMPLATE = `
  mutation($projectId: ID!, $templateId: ID!) {
    updateProjectV2(input: {
      projectId: $projectId,
      templateProjectId: $templateId
    }) {
      projectV2 {
        id
      }
    }
  }
`;

export const CREATE_PROJECT_FIELD = `
  mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $singleSelectOptions: [ProjectV2SingleSelectFieldOptionInput!]) {
    createProjectV2Field(input: {
      projectId: $projectId,
      name: $name,
      dataType: $dataType,
      singleSelectOptions: $singleSelectOptions
    }) {
      projectV2Field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options {
            id
            name
            color
          }
        }
      }
    }
  }
`;

export const CONVERT_DRAFT_TO_ISSUE = `
  mutation ConvertDraftToIssue($itemId: ID!, $repositoryId: ID!) {
    convertProjectV2DraftIssueItemToIssue(input: { itemId: $itemId, repositoryId: $repositoryId }) {
      item { id }
    }
  }
`;

export const GET_NODE_ID = `
  query GetNodeId($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
    }
  }
`;

export const GET_USER_ID = `
  query GetUserId($login: String!) {
    user(login: $login) {
      id
    }
  }
`;

export const GET_ORG_ID = `
  query GetOrgId($login: String!) {
    organization(login: $login) {
      id
    }
  }
`;

export const ADD_PROJECT_FIELD_OPTION = `
  mutation AddProjectV2SingleSelectFieldOption($fieldId: ID!, $name: String!, $color: ProjectV2SingleSelectFieldOptionColor) {
    addProjectV2SingleSelectFieldOption(input: {
      fieldId: $fieldId,
      name: $name,
      color: $color
    }) {
      field {
        ... on ProjectV2SingleSelectField {
          id
          name
          options {
            id
            name
            color
          }
        }
      }
    }
  }
`;

export const ADD_SUB_ISSUE = `
  mutation AddSubIssue($issueId: ID!, $subIssueId: ID!) {
    addSubIssue(input: {
      issueId: $issueId,
      subIssueId: $subIssueId
    }) {
      issue {
        id
        title
      }
      subIssue {
        id
        title
      }
    }
  }
`;
