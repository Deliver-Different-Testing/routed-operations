import { request } from './api';

// Recurring Routes port. Wraps GET /api/speeds/grouped so the Linehaul edit
// modal + Mapped Stops JobDetail modal can render an optgrouped Speed picker.
// Name kept consistent with the Configurator's `rateScheduleService` for
// cross-repo grep.

export interface ReportingSpeed {
  id: number;
  shortName: string;
  name: string;
  groupingId: number;
  groupingName: string | null;
}

export const rateScheduleService = {
  // Wrapped in { data } so the .data.data destructure in ported code keeps
  // working; the underlying envelope is `{ response: ReportingSpeed[] }`.
  async getSpeeds(): Promise<{ data: ReportingSpeed[] }> {
    const res = await request<{ response: ReportingSpeed[] }>('/speeds/grouped');
    return { data: res.response };
  },
};
