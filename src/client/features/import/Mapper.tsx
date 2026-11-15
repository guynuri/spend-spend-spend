import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, Field, Select } from '../../components/ui';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { MAP_FIELDS, guessColumns, headerSignature, mappingValid, parseWithMapping, type MapField, type Mapping } from '../../../shared/import/generic';
import type { Grid } from '../../../shared/import/types';
import { cellText } from '../../../shared/import/values';

const DATE_FORMATS: Mapping['dateFormat'][] = ['dmy', 'mdy', 'ymd', 'serial'];

export function Mapper({ grid, mapping, onChange, profileUsed }: { grid: Grid; mapping: Mapping; onChange: (m: Mapping, signature: string) => void; profileUsed: boolean }) {
  const { t } = useTranslation();
  const header = grid[mapping.headerRow] ?? [];
  const width = Math.max(...grid.slice(0, 50).map((r) => r.length), 0);
  const colLabel = (j: number) => `${String.fromCharCode(65 + (j % 26))}${j >= 26 ? Math.floor(j / 26) : ''} · ${cellText(header[j] ?? null) || '—'}`;
  const preview = useMemo(() => (mappingValid(mapping) ? parseWithMapping(grid.slice(0, mapping.headerRow + 6), mapping).rows.slice(0, 5) : []), [grid, mapping]);
  const set = (m: Mapping) => onChange(m, headerSignature(grid, m.headerRow));
  return (
    <div className="flex flex-col gap-3" data-testid="mapper">
      <p className="text-sm text-muted">{profileUsed ? t('import.profileUsed') : t('import.mapBody')}</p>
      <Field label={t('import.headerRow')} htmlFor="map-header">
        <Select
          id="map-header"
          value={mapping.headerRow}
          onChange={(e) => {
            const headerRow = Number(e.target.value);
            set({ ...mapping, headerRow, columns: guessColumns(grid[headerRow] ?? []) });
          }}
        >
          {grid.slice(0, 40).map((r, i) => (
            <option key={i} value={i}>
              {i + 1}: {r.filter((c) => c !== null).slice(0, 4).map((c) => cellText(c)).join(' · ').slice(0, 60)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MAP_FIELDS.map((f: MapField) => (
          <Field key={f} label={t(`import.fields.${f}`)} htmlFor={`map-${f}`}>
            <Select
              id={`map-${f}`}
              data-testid={`map-${f}`}
              value={mapping.columns[f] ?? ''}
              onChange={(e) => {
                const columns = { ...mapping.columns };
                if (e.target.value === '') delete columns[f];
                else columns[f] = Number(e.target.value);
                set({ ...mapping, columns });
              }}
            >
              <option value="">{t('import.notMapped')}</option>
              {Array.from({ length: width }, (_, j) => (
                <option key={j} value={j}>
                  {colLabel(j)}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <Field label={t('import.dateFormat')} htmlFor="map-df">
        <Select id="map-df" value={mapping.dateFormat} onChange={(e) => set({ ...mapping, dateFormat: e.target.value as Mapping['dateFormat'] })}>
          {DATE_FORMATS.map((d) => (
            <option key={d} value={d}>
              {t(`import.dateFormats.${d}`)}
            </option>
          ))}
        </Select>
      </Field>
      {mapping.columns.amount !== undefined && <Checkbox label={t('import.negate')} checked={mapping.negate} onChange={(v) => set({ ...mapping, negate: v })} testId="map-negate" />}
      {!mappingValid(mapping) ? (
        <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">{t('import.mappingInvalid')}</p>
      ) : (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-muted">{t('import.samplePreview')}</h3>
          <ul className="divide-y divide-border rounded-xl border border-border text-sm" data-testid="map-preview">
            {preview.map((r) => (
              <li key={r.row} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">
                  <DateText date={r.date} /> · <bdi>{r.description}</bdi>
                </span>
                <Money minor={r.amountMinor} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
