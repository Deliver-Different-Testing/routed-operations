import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvUtilityActions } from './RvUtilityActions';

function renderActions(overrides: Partial<Parameters<typeof RvUtilityActions>[0]> = {}) {
  const defaults = {
    onPrint: vi.fn(),
    onTopUp: vi.fn(),
    runDate: '2026-08-14',
    snapshotLayout: vi.fn(() => ({
      rvHorizontal: [25, 50, 25],
      rvLeftV: [50, 50],
      rvMidV: [50, 50],
      rvSlimV: [50, 50],
      rvRightV: [50, 50],
    })),
    onApplyLayout: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  renderWithProviders(<RvUtilityActions {...props} />);
  return props;
}

describe('RvUtilityActions', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders Print, Top Up, Layout buttons', () => {
    renderActions();
    expect(screen.getByRole('button', { name: /Print/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Top Up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Layout/ })).toBeInTheDocument();
  });

  it('opens print menu on Print click + fires onPrint on option', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    const option = await screen.findByRole('button', { name: 'Run Allocation' });
    await user.click(option);
    expect(props.onPrint).toHaveBeenCalledWith('runAllocation');
  });

  it('opens Labels sort picker modal on Print > Labels click', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    await user.click(await screen.findByRole('button', { name: 'Labels' }));
    // Modal opened, radio picker visible
    expect(screen.getByLabelText('Run Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Product')).toBeInTheDocument();
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
    // onPrint not yet fired - waits for Print button in modal
    expect(props.onPrint).not.toHaveBeenCalled();
  });

  it('fires onPrint("labels", { sortMode }) when Print inside Labels modal is clicked', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    await user.click(await screen.findByRole('button', { name: 'Labels' }));
    await user.click(screen.getByLabelText('Product'));
    await user.click(screen.getByRole('button', { name: 'Print' }));
    expect(props.onPrint).toHaveBeenCalledWith('labels', { sortMode: 2 });
  });

  it('opens Woop date picker modal on Print > Woop Report click', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    await user.click(await screen.findByRole('button', { name: 'Woop Report' }));
    // Modal opened, both date inputs seeded to runDate default
    const from = screen.getByLabelText(/From date/) as HTMLInputElement;
    const to = screen.getByLabelText(/To date/) as HTMLInputElement;
    expect(from.value).toBe('2026-08-14');
    expect(to.value).toBe('2026-08-14');
    expect(props.onPrint).not.toHaveBeenCalled();
  });

  it('fires onPrint("woop", { fromDate, toDate }) when Download inside Woop modal is clicked', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    await user.click(await screen.findByRole('button', { name: 'Woop Report' }));
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.onPrint).toHaveBeenCalledWith('woop', { fromDate: '2026-08-14', toDate: '2026-08-14' });
  });

  it('fires onTopUp on Top Up click', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Top Up' }));
    expect(props.onTopUp).toHaveBeenCalled();
  });

  it('opens layout menu on Layout click', async () => {
    renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Layout/ }));
    expect(await screen.findByText(/Save current layout/)).toBeInTheDocument();
    expect(screen.getByText(/Reset to default/)).toBeInTheDocument();
    expect(screen.getByText(/No saved layouts/)).toBeInTheDocument();
  });

  it('applies default layout on Reset click', async () => {
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Layout/ }));
    await user.click(await screen.findByText(/Reset to default/));
    expect(props.onApplyLayout).toHaveBeenCalled();
  });

  it('saves a new layout via prompt + then lists it', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('MyLayout');
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Layout/ }));
    await user.click(await screen.findByText(/Save current layout/));
    expect(props.snapshotLayout).toHaveBeenCalled();
    // Reopen menu; new layout should list
    await user.click(screen.getByRole('button', { name: /Layout/ }));
    expect(await screen.findByText('MyLayout')).toBeInTheDocument();
  });

  it('cancels save when prompt returns null (no name)', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce(null);
    const props = renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Layout/ }));
    await user.click(await screen.findByText(/Save current layout/));
    // snapshotLayout is NOT called if operator cancels
    expect(props.snapshotLayout).not.toHaveBeenCalled();
  });

  it('closes print menu on backdrop click', async () => {
    renderActions();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Print/ }));
    expect(await screen.findByText('Run Allocation')).toBeInTheDocument();
    // Click backdrop (the fixed inset-0 div)
    const backdrops = document.querySelectorAll('.fixed.inset-0.z-40');
    await user.click(backdrops[0]);
    expect(screen.queryByText('Run Allocation')).toBeNull();
  });
});
