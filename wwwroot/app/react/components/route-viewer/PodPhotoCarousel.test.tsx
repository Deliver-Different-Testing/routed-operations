import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { PodPhotoCarousel } from './PodPhotoCarousel';

const stubPhotos = (urls: string[]) =>
  http.get('/api/runviewer/jobs/pod-photos', () =>
    HttpResponse.json({ response: urls }),
  );

function renderCarousel(bulkJobId: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <PodPhotoCarousel bulkJobId={bulkJobId} />
    </QueryClientProvider>,
  );
}

describe('PodPhotoCarousel', () => {
  beforeEach(() => {
    server.use(stubPhotos([]));
  });

  it('renders nothing when bulkJobId is null', () => {
    const { container } = renderCarousel(null);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[class*="POD"]')).toBeNull();
  });

  it('renders nothing when server returns no photos', async () => {
    server.use(stubPhotos([]));
    const { container } = renderCarousel(42);
    await waitFor(() => {
      expect(container.querySelector('img')).toBeNull();
    });
  });

  it('renders a single photo without prev/next arrows', async () => {
    server.use(stubPhotos(['AAAA']));
    renderCarousel(1);
    await waitFor(() => {
      expect(screen.getByAltText(/POD photo 1$/)).toBeInTheDocument();
    });
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.queryByTitle('Previous')).toBeNull();
    expect(screen.queryByTitle('Next')).toBeNull();
  });

  it('shows prev/next when 2+ photos and cycles forward', async () => {
    server.use(stubPhotos(['AAAA', 'BBBB', 'CCCC']));
    renderCarousel(1);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Next'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    await user.click(screen.getByTitle('Next'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    // Wraps around
    await user.click(screen.getByTitle('Next'));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('cycles backward with prev (wraps to last)', async () => {
    server.use(stubPhotos(['AAAA', 'BBBB', 'CCCC']));
    renderCarousel(1);
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Previous'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    await user.click(screen.getByTitle('Previous'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('opens lightbox on image click and closes on Escape', async () => {
    server.use(stubPhotos(['AAAA']));
    renderCarousel(1);
    const img = await screen.findByAltText(/POD photo 1$/);
    const user = userEvent.setup();
    await user.click(img);
    // Lightbox appears with a large image labelled "full size"
    expect(await screen.findByAltText(/POD photo 1 full size/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByAltText(/POD photo 1 full size/)).toBeNull();
    });
  });

  it('closes lightbox on backdrop click', async () => {
    server.use(stubPhotos(['AAAA']));
    renderCarousel(1);
    const img = await screen.findByAltText(/POD photo 1$/);
    const user = userEvent.setup();
    await user.click(img);
    const full = await screen.findByAltText(/POD photo 1 full size/);
    const backdrop = full.parentElement!;
    await user.click(backdrop);
    await waitFor(() => {
      expect(screen.queryByAltText(/POD photo 1 full size/)).toBeNull();
    });
  });

  it('resets to first slide when bulkJobId changes', async () => {
    server.use(stubPhotos(['AAAA', 'BBBB']));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = renderWithProviders(
      <QueryClientProvider client={client}>
        <PodPhotoCarousel bulkJobId={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Next'));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    // Change the job
    rerender(
      <QueryClientProvider client={client}>
        <PodPhotoCarousel bulkJobId={2} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
  });
});
