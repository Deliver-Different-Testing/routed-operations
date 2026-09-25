import { request } from './api';

/**
 * TemplatesService - Pass C port. Talks to /api/templates (owner-scoped
 * per contact via the ContactID claim server-side). Used by the Bulk
 * Import wizard's Step 2 Select-Template dropdown and Save-as-template
 * checkbox.
 */

export interface TemplateMapping {
  urgentField: string;
  importField: string;
}

export interface TemplateDto {
  id: number;
  name: string;
  mappings: TemplateMapping[];
}

export interface TemplatesResponse {
  messageId: string;
  success: boolean;
  templates: TemplateDto[];
  messages?: Array<{ message?: string | null }>;
}

export interface TemplateResponse {
  messageId: string;
  success: boolean;
  template: TemplateDto;
  messages?: Array<{ message?: string | null }>;
}

export interface DeleteResponse {
  messageId: string;
  success: boolean;
  messages?: Array<{ message?: string | null }>;
}

export const templatesService = {
  getTemplates: (): Promise<{ response: TemplatesResponse }> =>
    request<TemplatesResponse>('/templates').then((raw) => ({ response: raw })),

  createTemplate: (
    name: string,
    mappings: TemplateMapping[]
  ): Promise<{ response: TemplateResponse }> =>
    request<TemplateResponse>('/templates', {
      method: 'POST',
      body: JSON.stringify({
        template: {
          name,
          mappings,
        },
      }),
    }).then((raw) => ({ response: raw })),

  deleteTemplate: (id: number): Promise<{ response: DeleteResponse }> =>
    request<DeleteResponse>(`/templates/${id}`, { method: 'DELETE' }).then((raw) => ({
      response: raw,
    })),
};
