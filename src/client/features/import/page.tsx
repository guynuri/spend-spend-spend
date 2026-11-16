import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, Upload } from 'lucide-react';
import { del, errorKey, get, post, put } from '../../api';
import { Badge, Button, Card, CardTitle, cx, EmptyState, ErrorState, Field, Input, PageHeader, ProgressBar, Select, Spinner } from '../../components/ui';
import { BankBadge, BankLink, useBankName } from '../../components/BankBadge';
import { Money } from '../../components/Money';
import { DateText } from '../../components/DateText';
import { ConfirmSheet } from '../../components/Confirm';
import { useToast } from '../../components/Toast';
import { LEDGER_DEPENDENT, QK, useAccounts, useCategoryMap } from '../../lib/queries';
import { bankUrl, inferAccount } from '../../../shared/banks';
import { useCanWrite } from '../../lib/session';
import { mappingValid, parseWithMapping, type Mapping } from '../../../shared/import/generic';
import { IMPORT_CHUNK, type ParseResult } from '../../../shared/import/types';
import { toWire, type ImportSummary, type PreviewResponse, type PreviewRow, type RowStatus } from '../../../shared/schemas/imports';
import { Mapper } from './Mapper';
import { decideParse, download, errorReportCsv, FileError, parseFile, type Parsed } from './parseFile';
import { AiSuggestButton } from '../ai/AiSuggest';

const ACCEPT = '.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv';
const countTiles = (c: Record<RowStatus, number>, errors: number) =>
  [
    ['countNew', c.new, 'new'],
    ['countDuplicate', c.duplicate, 'duplicate'],
    ['countManual', c.matches_manual, 'manual'],
    ['countError', errors, 'error'],
  ] as const;
const hasMismatch = (r: ParseResult) => r.warnings.includes('balance_mismatch');
type Step = 'pick' | 'parsing' | 'account' | 'map' | 'previewing' | 'preview' | 'committing' | 'done';

function History() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const canWrite = useCanWrite();
  const accounts = new Map((useAccounts().data?.accounts ?? []).map((a) => [a.id, a.name]));
  const q = useQuery({ queryKey: ['imports'], queryFn: () => get<{ imports: ImportSummary[] }>('/api/imports') });
  const [undoing, setUndoing] = useState<ImportSummary | null>(null);
  return (
    <Card>
      <CardTitle>{t('import.history')}</CardTitle>
      {q.isPending ? (
        <Spinner />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.imports.length === 0 ? (
        <p className="text-sm text-muted">{t('import.noHistory')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="import-history">
          {q.data.imports.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm" data-testid="import-row">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  <bdi>{i.fileName}</bdi>
                </div>
                <div className="text-xs text-muted">
                  {accounts.get(i.accountId)} · <DateText date={i.createdAt.slice(0, 10)} /> · {t('import.countNew')} {i.rowsInserted} · {t('import.countDuplicate')} {i.rowsDuplicate}
                </div>
              </div>
              {i.status === 'undone' ? (
                <Badge>{t('import.undone')}</Badge>
              ) : (
                canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => setUndoing(i)} data-testid="import-undo">
                    {t('import.undo')}
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmSheet
        open={!!undoing}
        onOpenChange={(o) => !o && setUndoing(null)}
        title={t('import.undo')}
        body={t('import.undoConfirm', { count: (undoing?.rowsInserted ?? 0) })}
        confirmLabel={t('import.undo')}
        testId="undo-confirm"
        onConfirm={async () => {
          try {
            await del(`/api/imports/${undoing!.id}`);
            await Promise.all(LEDGER_DEPENDENT.map((k) => qc.invalidateQueries({ queryKey: k })));
          } catch (e) {
            toast({ title: t(errorKey(e)), tone: 'bad' });
          }
        }}
      />
    </Card>
  );
}

export function Component() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const canWrite = useCanWrite();
  const cats = useCategoryMap();
  const accountsQ = useAccounts();
  const accounts = (accountsQ.data?.accounts ?? []).filter((a) => !a.archived && a.type !== 'credit_card');
  const bankName = useBankName();
  // '' = detect from the file; ask only when it can't be inferred
  // ?account=<id> preselects (reminder links); &openBank=1 offers the bank website prominently
  const [sp] = useSearchParams();
  const [accountId, setAccountId] = useState(() => sp.get('account') ?? '');
  const [autoPicked, setAutoPicked] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  // the file as parsed, before a saved mapping may have turned it into a generic import
  const [orig, setOrig] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [profileUsed, setProfileUsed] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; counts: Record<RowStatus, number> } | null>(null);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [apiError, setApiError] = useState<unknown>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Invariant: the rows shown and committed were derived for the selected account. Every re-derive
  // bumps `gen` and leaves the preview step first (no commit button while in flight); a response
  // whose `gen` is no longer current is dropped, so quick A→B→C switches can't land out of order.
  const gen = useRef(0);
  const acc = accountId;
  const accObj = accounts.find((a) => a.id === acc);

  const reset = () => {
    gen.current++; // drop any in-flight derive
    setStep('pick');
    setParsed(null);
    setResult(null);
    setPreview(null);
    setSummary(null);
    setApiError(null);
    setFileError(null);
    setMapping(null);
    if (autoPicked) setAccountId('');
    setAutoPicked(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const runPreview = async (r: ParseResult, account: string) => {
    const my = ++gen.current;
    setResult(r);
    setStep('previewing');
    try {
      const rows: PreviewRow[] = [];
      const counts: Record<RowStatus, number> = { new: 0, duplicate: 0, matches_manual: 0 };
      const wire = r.rows.map(toWire);
      for (let i = 0; i < wire.length; i += IMPORT_CHUNK) {
        const p = await post<PreviewResponse>('/api/imports/preview', { accountId: account, rows: wire.slice(i, i + IMPORT_CHUNK) });
        if (my !== gen.current) return;
        rows.push(...p.rows);
        for (const k of Object.keys(counts) as RowStatus[]) counts[k] += p.counts[k];
      }
      setPreview({ rows, counts });
      setStep('preview');
    } catch (e) {
      if (my !== gen.current) return;
      setApiError(e);
      setStep('pick');
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    setApiError(null);
    setStep('parsing');
    try {
      const p = await parseFile(file);
      // Card statements would double count the card lump already in the bank file (PLAN D-10).
      if (p.card) throw new FileError('card_file');
      setParsed(p);
      setOrig(p);
      const mask = p.result?.accountMask;
      const inferred = inferAccount(accounts, { accountMask: mask, bankIds: p.bankIds });
      // an account-number match beats the pre-selection; otherwise the user's pick wins
      const account = (mask && inferred?.accountMask === mask ? inferred.id : acc) || inferred?.id;
      setAutoPicked(!!account && account !== acc);
      if (!account) return setStep('account');
      setAccountId(account);
      await proceed(p, account);
    } catch (e) {
      setFileError(e instanceof FileError ? e.code : 'unsupported_file');
      setStep('pick');
    }
  };

  const createAccount = async () => {
    setCreating(true);
    try {
      const { id } = await post<{ id: string }>('/api/accounts', { name: newName.trim(), type: 'checking', bankId: parsed?.bankIds[0] ?? null });
      await qc.invalidateQueries({ queryKey: QK.accounts });
      setAccountId(id);
      await proceed(orig!, id);
    } catch (e) {
      setApiError(e);
    } finally {
      setCreating(false);
    }
  };

  /** Derives the rows for `account` from the file as parsed (`orig`). `current` = the user's mapping, kept when the account has none. */
  const proceed = async (p: Parsed, account: string, current?: Mapping | null) => {
    const my = ++gen.current;
    setStep('previewing');
    // A mapping the household saved for this header wins over format detection, so re-imports keep
    // the same description column and dedupe keys.
    let profiles: Map<string, Mapping>;
    try {
      const r = await get<{ profiles: { headerSignature: string; mapping: Mapping }[] }>(`/api/import-profiles?accountId=${account}`);
      profiles = new Map(r.profiles.map((x) => [x.headerSignature, x.mapping]));
    } catch (e) {
      // never derive rows without knowing the account's saved mapping
      if (my !== gen.current) return;
      setApiError(e);
      return setStep('pick');
    }
    if (my !== gen.current) return;
    const d = decideParse(p, profiles, current);
    if ('result' in d) {
      setParsed(p);
      return void (await runPreview(d.result, account));
    }
    setParsed(p.result ? { ...p, parserId: 'generic', result: null } : p);
    setMapping(d.mapping);
    setProfileUsed(d.profileUsed);
    setSignature(d.signature);
    setStep('map');
  };

  const commit = async () => {
    if (!result || !parsed) return;
    setStep('committing');
    setProgress(0);
    let importId: string | null = null;
    try {
      const wire = result.rows.map(toWire);
      if (parsed.parserId === 'generic' && mapping && signature) await put('/api/import-profiles', { accountId: acc, headerSignature: signature, mapping });
      ({ importId } = await post<{ importId: string }>('/api/imports', {
        accountId: acc,
        parserId: parsed.parserId,
        fileName: parsed.fileName.slice(0, 120),
        fileHash: parsed.fileHash,
        period: result.period ?? null,
        rowsTotal: wire.length,
        rowsError: result.errors.length,
        closingBalance: result.closingBalance ?? null,
      }));
      const chunks = Math.max(1, Math.ceil(wire.length / IMPORT_CHUNK));
      for (let i = 0, n = 0; i < wire.length; i += IMPORT_CHUNK, n++) {
        await post(`/api/imports/${importId}/rows`, { rows: wire.slice(i, i + IMPORT_CHUNK) });
        setProgress((n + 1) / (chunks + 1));
      }
      const s = await post<ImportSummary>(`/api/imports/${importId}/commit`);
      setProgress(1);
      setSummary(s);
      setStep('done');
      await Promise.all(LEDGER_DEPENDENT.map((k) => qc.invalidateQueries({ queryKey: k })));
    } catch (e) {
      // Discard the unfinished upload so a retry starts clean (no orphaned half-import).
      if (importId) await del(`/api/imports/${importId}?onlyOpen=1`).catch(() => {});
      setApiError(e);
      setStep('preview');
    }
  };

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
      {a.accountMask ? ` ··${a.accountMask}` : ''}
    </option>
  ));
  const parserLabel = !parsed || parsed.parserId === 'generic' ? t('import.parsers.generic') : parsed.bankIds.map((id) => bankName({ bankId: id })).join(' / ');
  const errorLabel = (code: string) => t(`import.errorCodes.${code}`, { defaultValue: code });
  const errors = result?.errors ?? [];
  const toImport = preview ? preview.counts.new + preview.counts.matches_manual : 0;
  const byRow = new Map(result?.rows.map((r) => [r.row, r]) ?? []);

  if (!canWrite)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('import.title')} />
        <History />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('import.title')} subtitle={t('import.subtitle')} />
      {accountsQ.data && accounts.length === 0 ? (
        <EmptyState
          title={t('import.newAccount')}
          action={
            <Link to="/accounts" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-medium text-accent-fg">
              {t('ledger.goAccounts')}
            </Link>
          }
        />
      ) : (
        <>
          {(step === 'pick' || step === 'parsing') && (
            <Card>
              <div className="flex flex-col gap-3">
                <Field label={t('import.account')} htmlFor="imp-acc">
                  <Select id="imp-acc" value={acc} onChange={(e) => setAccountId(e.target.value)} data-testid="import-account">
                    <option value="">{t('import.autoDetect')}</option>
                    {accountOptions}
                  </Select>
                </Field>
                {accObj && sp.get('openBank') === '1' && bankUrl(accObj) ? (
                  <a href={bankUrl(accObj)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-fg" data-testid="import-open-bank">
                    <ExternalLink className="size-5" aria-hidden />
                    {t('import.openBankNamed', { bank: bankName(accObj) })}
                  </a>
                ) : (
                  accObj && <BankLink account={accObj} />
                )}
                <label
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void onFile(e.dataTransfer.files[0]);
                  }}
                  className={cx('flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition', dragOver ? 'border-accent bg-accent/5' : 'border-border')}
                >
                  {step === 'parsing' ? <Spinner /> : <FileSpreadsheet className="size-10 text-accent" aria-hidden />}
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-fg">
                    <Upload className="size-4" aria-hidden />
                    {t('import.choose')}
                  </span>
                  <span className="hidden text-sm text-muted md:block">{t('import.drop')}</span>
                  <span className="text-xs text-muted">{t('import.accepted')}</span>
                  <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" data-testid="import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
                </label>
                {fileError && (
                  <p role="alert" className="rounded-xl bg-bad/10 p-3 text-sm text-bad" data-testid="import-file-error">
                    {t(`import.fileErrors.${fileError}`)}
                  </p>
                )}
                {!!apiError && <ErrorState error={apiError} />}
              </div>
            </Card>
          )}

          {step === 'account' && parsed && (
            <Card data-testid="import-ask-account">
              <CardTitle>{t('import.whichAccount')}</CardTitle>
              <p className="mb-3 text-sm text-muted">
                {parsed.parserId === 'generic' ? t('import.whichAccountBody') : t('import.whichAccountBank', { bank: parserLabel })}
              </p>
              <div className="flex flex-col gap-3">
                <Field label={t('import.account')} htmlFor="imp-ask">
                  <Select id="imp-ask" value={acc} onChange={(e) => setAccountId(e.target.value)} data-testid="import-ask-select">
                    <option value="" disabled>
                      {t('import.pickAccount')}
                    </option>
                    {accountOptions}
                  </Select>
                </Field>
                <Button disabled={!acc} onClick={() => void proceed(orig ?? parsed, acc)} data-testid="import-ask-continue">
                  {t('common.next')}
                </Button>
                <Field label={t('import.orCreate')} htmlFor="imp-new">
                  <div className="flex gap-2">
                    <Input id="imp-new" dir="auto" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={bankName({ bankId: parsed.bankIds[0] }) ?? ''} data-testid="import-new-name" />
                    <Button variant="secondary" disabled={!newName.trim()} busy={creating} onClick={() => void createAccount()} data-testid="import-new-create">
                      {t('import.create')}
                    </Button>
                  </div>
                </Field>
                {!!apiError && <ErrorState error={apiError} />}
                <Button variant="ghost" onClick={reset}>
                  {t('import.cancel')}
                </Button>
              </div>
            </Card>
          )}

          {step === 'map' && parsed && mapping && (
            <Card>
              <CardTitle>{t('import.mapTitle')}</CardTitle>
              <Mapper
                grid={parsed.grid}
                mapping={mapping}
                profileUsed={profileUsed}
                onChange={(m, sig) => {
                  setMapping(m);
                  setSignature(sig);
                }}
              />
              <div className="mt-4 flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={reset}>
                  {t('import.cancel')}
                </Button>
                <Button disabled={!mappingValid(mapping)} onClick={() => void runPreview(parseWithMapping(parsed.grid, mapping), acc)} data-testid="map-continue">
                  {t('common.next')}
                </Button>
              </div>
            </Card>
          )}

          {step === 'previewing' && <Spinner />}

          {(step === 'preview' || step === 'committing') && result && preview && parsed && (
            <Card data-testid="import-preview">
              <CardTitle>{t('import.previewTitle')}</CardTitle>
              <p className="mb-2 text-sm text-muted">
                {t('import.detected', { parser: parserLabel })} · {t('import.rowsInFile', { count: result.rows.length })}
              </p>
              <div className="mb-2 flex items-end gap-2">
                <BankBadge bankId={accObj?.bankId} institution={accObj?.institution} size="md" />
                <div className="min-w-0 flex-1">
                  <Field label={autoPicked ? t('import.accountDetected') : t('import.account')} htmlFor="imp-acc2">
                    <Select
                      id="imp-acc2"
                      value={acc}
                      disabled={step === 'committing'}
                      onChange={(e) => {
                        setAccountId(e.target.value);
                        setAutoPicked(false);
                        // re-derive everything for the new account (its own saved mapping, its own preview)
                        void proceed(orig!, e.target.value, mapping);
                      }}
                      data-testid="import-preview-account"
                    >
                      {accountOptions}
                    </Select>
                  </Field>
                </div>
              </div>
              {accObj && <BankLink account={accObj} className="mb-2" />}
              {result.accountMask && (
                <p className={cx('mb-2 text-sm', accObj?.accountMask && accObj.accountMask !== result.accountMask ? 'text-warn' : 'text-muted')}>
                  {accObj?.accountMask && accObj.accountMask !== result.accountMask
                    ? t('import.maskMismatch', { mask: result.accountMask })
                    : t('import.maskHint', { mask: result.accountMask })}
                </p>
              )}
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="import-counts">
                {countTiles(preview.counts, errors.length).map(([k, v, id]) => (
                  <div key={k} className="rounded-xl bg-surface-2 p-2" data-testid={`count-${id}`} data-value={v}>
                    <dt className="text-xs text-muted">{t(`import.${k}`)}</dt>
                    <dd className="tabular text-lg font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
                {result.period && (
                  <div>
                    <dt className="text-xs text-muted">{t('import.period')}</dt>
                    <dd>
                      <DateText date={result.period.from} /> – <DateText date={result.period.to} />
                    </dd>
                  </div>
                )}
                {result.closingBalance && (
                  <div>
                    <dt className="text-xs text-muted">{t('import.closing')}</dt>
                    <dd>
                      <Money minor={result.closingBalance.minor} /> (<DateText date={result.closingBalance.date} />)
                    </dd>
                  </div>
                )}
              </dl>
              {hasMismatch(result) && (
                <p className="mb-3 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm text-warn" data-testid="balance-warning">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden />
                  {t('import.balanceMismatch')}
                </p>
              )}
              {errors.length > 0 && (
                <div className="mb-3 rounded-xl border border-border p-3" data-testid="import-errors">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{t('import.errorsTitle')}</h3>
                    <Button size="sm" variant="secondary" onClick={() => download(errorReportCsv(errors, errorLabel), `import-errors-${parsed.fileName}.csv`)} data-testid="download-errors">
                      {t('import.downloadErrors')}
                    </Button>
                  </div>
                  <ul className="text-xs">
                    {errors.slice(0, 20).map((e) => (
                      <li key={e.row}>
                        {t('import.rowNo')} {e.row}: {errorLabel(e.code)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <h3 className="mb-1 text-sm font-semibold text-muted">{t('import.firstRows', { count: Math.min(200, preview.rows.length) })}</h3>
              <ul className="mb-3 max-h-96 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm" data-testid="preview-rows">
                {preview.rows.slice(0, 200).map((p) => {
                  const r = byRow.get(p.row)!;
                  return (
                    <li key={p.row} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          <bdi>{r.description}</bdi>
                        </div>
                        <div className="text-xs text-muted">
                          <DateText date={r.date} /> · {p.categoryId ? cats.get(p.categoryId)?.name : t('ledger.uncategorized')}
                        </div>
                      </div>
                      <Badge tone={p.status === 'new' ? 'good' : p.status === 'duplicate' ? 'neutral' : 'accent'}>{t(`import.statuses.${p.status}`)}</Badge>
                      <Money minor={r.amountMinor} />
                    </li>
                  );
                })}
              </ul>
              {step === 'committing' && <ProgressBar value={progress} label={t('import.importing')} />}
              {!!apiError && <ErrorState error={apiError} />}
              <div className="mt-3 flex flex-wrap justify-between gap-2">
                <Button variant="ghost" onClick={reset} disabled={step === 'committing'}>
                  {t('import.cancel')}
                </Button>
                <Button onClick={() => void commit()} busy={step === 'committing'} disabled={toImport === 0} data-testid="import-commit">
                  {toImport === 0 ? t('import.commitNothing') : t('import.commit', { count: toImport })}
                </Button>
              </div>
            </Card>
          )}

          {step === 'done' && summary && (
            <Card data-testid="import-done">
              <div className="flex flex-col items-center gap-2 text-center">
                <CheckCircle2 className="size-10 text-good" aria-hidden />
                <h2 className="text-lg font-semibold">{t('import.doneTitle')}</h2>
                <p className="text-sm text-muted" data-testid="import-done-summary" data-inserted={summary.rowsInserted} data-duplicates={summary.rowsDuplicate}>
                  {t('import.doneBody', { inserted: summary.rowsInserted, duplicates: summary.rowsDuplicate, merged: summary.rowsMerged, errors: summary.rowsError })}
                </p>
                {errors.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => download(errorReportCsv(errors, errorLabel), `import-errors-${parsed?.fileName}.csv`)}>
                    {t('import.downloadErrors')}
                  </Button>
                )}
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <Link to={summary.periodStart && summary.periodEnd ? `/transactions?from=${summary.periodStart}&to=${summary.periodEnd}` : '/transactions'} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-medium text-accent-fg" data-testid="import-view-ledger">
                    {t('import.viewLedger')}
                  </Link>
                  <Button variant="secondary" onClick={reset} data-testid="import-another">
                    {t('import.another')}
                  </Button>
                  <AiSuggestButton />
                </div>
              </div>
            </Card>
          )}
        </>
      )}
      <History />
    </div>
  );
}
