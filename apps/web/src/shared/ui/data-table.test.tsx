import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type Column } from './data-table';

interface SampleRow {
  id: number;
  name: string;
}

const columns: Column<SampleRow>[] = [
  { header: 'ID', accessor: (row) => row.id },
  { header: 'Name', accessor: (row) => row.name },
];

const data: SampleRow[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

/** jsdom has no ResizeObserver; this one lets a test announce a size change. */
class ManualObserver {
  static instances: ManualObserver[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ManualObserver.instances.push(this);
  }

  observe() {}

  unobserve() {}

  disconnect() {}

  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

afterEach(() => {
  ManualObserver.instances = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DataTable', () => {
  it('renders columns and rows', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('shows empty message when data is empty', () => {
    render(<DataTable columns={columns} data={[]} emptyMessage="Sin resultados" />);

    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });

  it('renders pagination slot when provided', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        pagination={<div>Page 1 of 10</div>}
      />,
    );

    expect(screen.getByText('Page 1 of 10')).toBeInTheDocument();
  });
});

describe('DataTable scroll region', () => {
  it('names the scroll region after the caption it renders for the table', () => {
    render(<DataTable columns={columns} data={data} caption="Usuarios del sistema" />);

    const region = screen.getByRole('region', { name: 'Usuarios del sistema' });
    const table = within(region).getByRole('table', { name: 'Usuarios del sistema' });
    expect(table.querySelector('caption')).toHaveTextContent('Usuarios del sistema');
    expect(table.querySelector('caption')).toHaveClass('sr-only');
  });

  it('falls back to a generic name when no caption is given', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole('region', { name: 'Tabla de datos' })).toBeInTheDocument();
    expect(screen.getByRole('table').querySelector('caption')).toBeNull();
  });

  it('joins the tab order only while its content overflows', () => {
    vi.stubGlobal('ResizeObserver', ManualObserver);
    let scrollWidth = 300;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => scrollWidth);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 300);

    render(<DataTable columns={columns} data={data} caption="Usuarios" />);
    const region = screen.getByRole('region', { name: 'Usuarios' });
    expect(region).not.toHaveAttribute('tabindex');

    scrollWidth = 520;
    act(() => ManualObserver.instances.forEach((observer) => observer.notify()));
    expect(region).toHaveAttribute('tabindex', '0');

    scrollWidth = 300;
    act(() => ManualObserver.instances.forEach((observer) => observer.notify()));
    expect(region).not.toHaveAttribute('tabindex');
  });

  it('keeps the pagination outside the scroll region, in a footer that wraps', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        caption="Usuarios"
        pagination={<nav aria-label="Paginación">1</nav>}
      />,
    );

    const region = screen.getByRole('region', { name: 'Usuarios' });
    const nav = screen.getByRole('navigation', { name: 'Paginación' });
    expect(region).not.toContainElement(nav);
    expect(nav.parentElement).toHaveClass('flex-wrap', 'min-w-0', '@container/pagination');
  });
});

describe('DataTable stacked layout', () => {
  interface Job {
    id: string;
    name: string;
    status: string;
    size: string;
    host: string;
    origin: string;
  }

  const jobs: Job[] = [
    { id: 'a', name: 'orders-db', status: 'Completado', size: '12 MB', host: 'db.internal', origin: 'Manual' },
  ];

  const stackedColumns: Column<Job>[] = [
    { header: 'Conexión', accessor: (job) => job.name, stack: 'title' },
    { header: 'Estado', accessor: (job) => job.status, stack: 'badge' },
    { header: 'Tamaño', accessor: (job) => job.size },
    { header: 'Puerto', accessor: () => '5432', stackLabel: 'Puerto TCP' },
    { header: 'Host', accessor: (job) => job.host, stack: 'field', stackLabel: 'Servidor', priority: 2 },
    { header: 'Origen', accessor: (job) => job.origin, stack: 'meta', priority: 3 },
    { header: 'Acciones', accessor: () => <button type="button">Restaurar</button>, stack: 'actions' },
  ];

  function cellOf(text: string) {
    return screen.getByText(text).closest('td') as HTMLElement;
  }

  it('turns the table into a named container only when it reflows or hides columns', () => {
    const { container, rerender } = render(<DataTable columns={columns} data={data} />);
    expect(container.firstElementChild).not.toHaveClass('@container/table');

    rerender(<DataTable columns={stackedColumns} data={jobs} narrowLayout="stack" />);
    expect(container.firstElementChild).toHaveClass('@container/table');

    rerender(<DataTable columns={[{ ...columns[0], priority: 3 }, columns[1]]} data={data} />);
    expect(container.firstElementChild).toHaveClass('@container/table');
  });

  it('places each cell by its stack role and hides the header row visually', () => {
    render(<DataTable columns={stackedColumns} data={jobs} narrowLayout="stack" />);

    expect(screen.getByRole('table').querySelector('thead')).toHaveClass('@max-2xl/table:sr-only');
    expect(screen.getByRole('table')).toHaveClass('@max-2xl/table:min-w-0');
    expect(screen.getByRole('row', { name: /orders-db/ })).toHaveClass('@max-2xl/table:flex', '@max-2xl/table:flex-wrap');
    expect(cellOf('orders-db')).toHaveClass('@max-2xl/table:order-1', '@max-2xl/table:flex-1');
    expect(cellOf('Completado')).toHaveClass('@max-2xl/table:order-2');
    expect(cellOf('12 MB')).toHaveClass('@max-2xl/table:order-6', '@max-2xl/table:basis-full');
    expect(cellOf('Restaurar')).toHaveClass('@max-2xl/table:order-3', 'relative', 'z-10');
  });

  it('labels field cells with a visual-only label and leaves the other roles unlabelled', () => {
    render(<DataTable columns={stackedColumns} data={jobs} narrowLayout="stack" />);

    const sizeLabel = within(cellOf('12 MB')).getByText('Tamaño');
    expect(sizeLabel).toHaveAttribute('aria-hidden', 'true');
    expect(sizeLabel).toHaveClass('hidden', '@max-2xl/table:inline');
    expect(within(cellOf('5432')).getByText('Puerto TCP')).toHaveAttribute('aria-hidden', 'true');
    // A column hidden below 42rem never shows in the stacked rows, so it gets no label.
    expect(within(cellOf('db.internal')).queryByText('Servidor')).toBeNull();

    expect(within(cellOf('orders-db')).queryByText('Conexión')).toBeNull();
    expect(within(cellOf('Completado')).queryByText('Estado')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Tamaño' })).toBeInTheDocument();
  });

  it('hides lower priority columns by container width, header and cell alike', () => {
    render(<DataTable columns={stackedColumns} data={jobs} narrowLayout="stack" />);

    expect(screen.getByRole('columnheader', { name: 'Host' })).toHaveClass('@max-2xl/table:hidden');
    expect(cellOf('db.internal')).toHaveClass('@max-2xl/table:hidden');
    expect(cellOf('db.internal')).not.toHaveClass('@max-2xl/table:flex');
    expect(screen.getByRole('columnheader', { name: 'Origen' })).toHaveClass('@max-4xl/table:hidden');
    expect(cellOf('Manual')).toHaveClass('@max-4xl/table:hidden');
    expect(cellOf('12 MB')).not.toHaveClass('@max-2xl/table:hidden');
    expect(cellOf('12 MB')).not.toHaveClass('@max-4xl/table:hidden');
  });

  it('keeps exactly one row link that covers the whole card', () => {
    render(
      <MemoryRouter>
        <DataTable
          columns={stackedColumns.slice(0, 3)}
          data={jobs}
          narrowLayout="stack"
          rowHref={(job) => `/jobs/${job.id}`}
          rowLinkLabel={(job) => `Ver ${job.name}`}
        />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/jobs/a');
    expect(links[0]).toHaveAccessibleName('Ver orders-db');
    expect(links[0]).toHaveClass('after:absolute', 'after:inset-0');
    expect(links[0].closest('tr')).toHaveClass('relative');
  });

  it('draws a loading card with the loaded card lines: title, meta and fields', () => {
    render(<DataTable columns={stackedColumns} data={[]} loading skeletonRows={1} narrowLayout="stack" />);

    const cells = Array.from(screen.getByRole('table').querySelectorAll('tbody td'));
    const [title, badge, size, port, host, origin, actions] = cells;
    expect(title).toHaveClass('@max-2xl/table:order-1');
    expect(title.firstElementChild).toHaveClass('@max-2xl/table:w-3/5');
    expect(size.firstElementChild).toHaveClass('@max-2xl/table:w-4/5');
    expect(port.firstElementChild).toHaveClass('@max-2xl/table:w-4/5');
    expect(badge).toHaveClass('@max-2xl/table:hidden');
    expect(actions).toHaveClass('@max-2xl/table:hidden');
    expect(host).toHaveClass('@max-2xl/table:hidden');
    expect(origin).toHaveClass('@max-4xl/table:hidden');
  });

  it('leaves tables that do not opt in rendered as before', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole('table')).toHaveClass('min-w-[360px]');
    expect(screen.getByRole('table')).not.toHaveClass('@max-2xl/table:min-w-0');
    expect(screen.getByRole('table').querySelector('thead')).not.toHaveClass('@max-2xl/table:sr-only');
    expect(screen.getByText('Alice').closest('td')?.className).not.toContain('@max-');
    expect(screen.getAllByText('Name')).toHaveLength(1);
  });
});
