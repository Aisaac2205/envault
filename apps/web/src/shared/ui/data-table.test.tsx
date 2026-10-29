import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ClampText, DataTable, RowActionsMenu, type Column } from './data-table';

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

  // Preflight resets border colours to currentColor, so a bare border-t draws in
  // the text colour. jsdom ignores CSS: this pins the class contract.
  it('draws the footer rule in the border token of the table, not in the text colour', () => {
    render(
      <DataTable
        columns={columns}
        data={data}
        caption="Usuarios"
        pagination={<nav aria-label="Paginación">1</nav>}
      />,
    );

    const footer = screen.getByRole('navigation', { name: 'Paginación' }).parentElement;
    expect(footer).toHaveClass('border-t', 'border-border/60');
  });

  it('positions the region, so visually hidden header text scrolls with the table instead of widening the page', () => {
    const withHiddenHeader: Column<SampleRow>[] = [
      ...columns,
      { header: <span className="sr-only">Acciones</span>, accessor: () => null },
    ];
    render(<DataTable columns={withHiddenHeader} data={data} caption="Usuarios" />);

    const region = screen.getByRole('region', { name: 'Usuarios' });
    expect(region).toHaveClass('relative', 'overflow-x-auto');
    expect(region).toContainElement(screen.getByText('Acciones'));
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

  it('gives footer cells a last line of their own, unlabelled and above the row link', () => {
    const withFooter: Column<Job>[] = [
      stackedColumns[0],
      { header: 'Prueba', accessor: () => <button type="button">Probar</button>, stack: 'footer' },
    ];
    render(<DataTable columns={withFooter} data={jobs} narrowLayout="stack" />);

    const footer = cellOf('Probar');
    expect(footer).toHaveClass('@max-2xl/table:order-7', '@max-2xl/table:basis-full', 'relative', 'z-10');
    expect(within(footer).queryByText('Prueba')).toBeNull();
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

describe('DataTable fixed layout', () => {
  interface Entry {
    id: string;
    action: string;
    actor: string;
    size: string;
    resource: string;
    origin: string;
  }

  const entries: Entry[] = [
    { id: 'e1', action: 'POST /api/backups/trigger', actor: 'ops@envault.local', size: '12 MB', resource: 'orders-db', origin: 'Cronjob' },
  ];

  const fixedColumns: Column<Entry>[] = [
    { header: 'Acción', accessor: (e) => e.action, stack: 'title', align: 'left' },
    { header: 'Usuario', accessor: (e) => e.actor, stack: 'meta', width: 'w-40 @4xl/table:w-56', align: 'left' },
    { header: 'Tamaño', accessor: (e) => e.size, width: 'w-24', align: 'right' },
    { header: 'Origen', accessor: (e) => e.origin, width: 'w-20', priority: 3 },
    { header: 'Recurso', accessor: (e) => e.resource, stack: 'field', stackOnly: true },
  ];

  function renderFixed(props: Partial<Parameters<typeof DataTable<Entry>>[0]> = {}) {
    return render(
      <MemoryRouter>
        <DataTable columns={fixedColumns} data={entries} layout="fixed" narrowLayout="stack" {...props} />
      </MemoryRouter>,
    );
  }

  function colsOf(table: HTMLElement) {
    return Array.from(table.querySelectorAll('colgroup > col'));
  }

  it('sizes the columns from a colgroup, leaving the lead column the rest of the width', () => {
    renderFixed();
    const table = screen.getByRole('table');

    expect(table).toHaveClass('table-fixed');
    const cols = colsOf(table);
    // The stack-only column has no column in the table layout.
    expect(cols).toHaveLength(4);
    expect(cols[0].className).toBe('');
    expect(cols[1]).toHaveClass('w-40', '@4xl/table:w-56');
    expect(cols[2]).toHaveClass('w-24');
    // A column that hides by priority takes its width away with it.
    expect(cols[3]).toHaveClass('w-20', '@max-4xl/table:hidden');
    // Cards have no columns: the colgroup stays out of the stacked layout.
    expect(table.querySelector('colgroup')).toHaveClass('@max-2xl/table:hidden');
  });

  it('adds a column for the row link', () => {
    renderFixed({ rowHref: (e) => `/audit/${e.id}` });

    const cols = colsOf(screen.getByRole('table'));
    expect(cols).toHaveLength(5);
    expect(cols[4]).toHaveClass('w-10');
  });

  it('makes the table a container even when no column reflows, so widths can follow its room', () => {
    const { container } = render(
      <DataTable columns={[{ header: 'Name', accessor: (row: SampleRow) => row.name, width: 'w-40 @4xl/table:w-56' }, columns[0]]} data={data} layout="fixed" />,
    );

    expect(container.firstElementChild).toHaveClass('@container/table');
  });

  it('keeps a stack-only column out of the table layout and in the cards', () => {
    renderFixed();

    const header = screen.getByRole('columnheader', { name: 'Recurso' });
    const cell = screen.getByText('orders-db').closest('td') as HTMLElement;
    expect(header).toHaveClass('@2xl/table:hidden');
    expect(cell).toHaveClass('@2xl/table:hidden', '@max-2xl/table:order-6');
    expect(within(cell).getByText('Recurso')).toHaveAttribute('aria-hidden', 'true');
  });

  it('aligns a column and its header as asked', () => {
    renderFixed();

    for (const name of ['Acción', 'Usuario']) {
      expect(screen.getByRole('columnheader', { name })).toHaveClass('text-left', '[&:not(:first-child)]:text-left');
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('[&:not(:first-child)]:text-center');
    }
    expect(screen.getByText('ops@envault.local').closest('td')).toHaveClass('text-left', '[&:not(:first-child)]:text-left');
    expect(screen.getByRole('columnheader', { name: 'Tamaño' })).toHaveClass('text-right', '[&:not(:first-child)]:text-right');
    // Stacked rows keep their figures; the table lines them up digit by digit.
    expect(screen.getByText('12 MB').closest('td')).toHaveClass('text-right', '@2xl/table:tabular-nums');
    // A column that does not ask keeps the table's default alignment.
    expect(screen.getByText('Cronjob').closest('td')).toHaveClass('[&:not(:first-child)]:text-center');
  });

  it('pads cells compactly, the dashboard spacing', () => {
    renderFixed();

    const cell = screen.getByText('12 MB').closest('td');
    expect(cell).toHaveClass('px-3', 'py-3');
    expect(cell).not.toHaveClass('px-6');
    expect(screen.getByRole('columnheader', { name: 'Tamaño' })).toHaveClass('px-3');
  });

  it('leaves the default layout without a colgroup', () => {
    render(<DataTable columns={columns} data={data} />);

    expect(screen.getByRole('table')).not.toHaveClass('table-fixed');
    expect(screen.getByRole('table').querySelector('colgroup')).toBeNull();
  });
});

describe('ClampText', () => {
  it('shows two lines at most in the table layout and keeps the full text in its title and in the DOM', () => {
    const long = 'POST /api/backups/3e6bc28a-def9-4f2c-82ff-bc715a611bd8/download-url';
    render(<ClampText text={long} className="text-xs" />);

    const text = screen.getByText(long);
    expect(text).toHaveAttribute('title', long);
    expect(text).toHaveClass('text-xs', '@2xl/table:line-clamp-2', '@2xl/table:whitespace-normal', '@2xl/table:[overflow-wrap:anywhere]');
  });
});

describe('RowActionsMenu', () => {
  function renderMenu(onDelete = vi.fn(), onTest = vi.fn()) {
    render(
      <RowActionsMenu
        label="Acciones de orders-db"
        actions={[
          { label: 'Eliminar', onSelect: onDelete, destructive: true },
          { label: 'Probar conexión', onSelect: onTest },
          { label: 'Editar', onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );
    return { onDelete, onTest };
  }

  it('names the trigger after its row, with a visible focus ring and a 32px target', () => {
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Acciones de orders-db' });
    expect(trigger).toHaveClass('size-8', 'focus-visible:ring-2');
  });

  it('lists the safe actions first and keeps the destructive ones apart, in the destructive colour', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderMenu();

    await user.click(screen.getByRole('button', { name: 'Acciones de orders-db' }));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Probar conexión', 'Editar', 'Eliminar']);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    expect(items[2]).toHaveClass('text-destructive');
    expect(items[1]).toHaveAttribute('data-disabled');

    await user.click(items[2]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('draws no separator when there is nothing destructive', async () => {
    const user = userEvent.setup();
    render(<RowActionsMenu label="Acciones" actions={[{ label: 'Editar', onSelect: vi.fn() }]} />);

    await user.click(screen.getByRole('button', { name: 'Acciones' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('separator')).toBeNull();
  });
});
