import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { del, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, Checkbox, cx, ErrorState, Field, IconButton, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { AddCategorySheet, useCategorySuggestions } from '../../components/AddCategorySheet';
import { ConfirmSheet } from '../../components/Confirm';
import { CategorySelect } from '../../components/CategorySelect';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useCategories, useCategoryMap, useRules } from '../../lib/queries';
import { useCanWrite } from '../../lib/session';
import type { Category, Rule } from '../../../shared/schemas/ledger';

const KINDS: Category['kind'][] = ['expense', 'income', 'transfer'];
const MATCHES: Rule['match'][] = ['contains', 'equals', 'starts_with'];
const SIGNS: Rule['sign'][] = ['any', 'in', 'out'];

function CategoryForm({ cat, onDone }: { cat: Category; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(cat.name);
  const kind = cat.kind;
  const [grp, setGrp] = useState<'fixed' | 'variable'>(cat.grp ?? 'variable');
  const [isDebt, setIsDebt] = useState(cat.isDebt);
  const save = useApiMutation(() => patch(`/api/categories/${cat.id}`, { name: name.trim(), ...(kind === 'expense' ? { grp, isDebt } : {}) }), {
    invalidate: [['categories'], ...LEDGER_DEPENDENT],
    onSuccess: onDone,
    successKey: 'ledger.saved',
  });
  const remove = useApiMutation(() => del<{ archived?: boolean }>(`/api/categories/${cat.id}`), {
    invalidate: [['categories']],
    onSuccess: (r) => {
      toast({ title: t(r.archived ? 'categories.archivedToast' : 'categories.deleted') });
      onDone();
    },
  });
  const restore = useApiMutation(() => patch(`/api/categories/${cat.id}`, { archived: false }), { invalidate: [['categories']], onSuccess: onDone });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <Field label={t('categories.name')} htmlFor="cat-name">
        <Input id="cat-name" dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} data-testid="category-name" />
      </Field>
      {kind === 'expense' && (
        <>
          <Field label={t('categories.group')} htmlFor="cat-grp">
            <Select id="cat-grp" value={grp} onChange={(e) => setGrp(e.target.value as 'fixed' | 'variable')}>
              <option value="fixed">{t('categories.fixed')}</option>
              <option value="variable">{t('categories.variable')}</option>
            </Select>
          </Field>
          <div>
            <Checkbox label={t('categories.isDebt')} checked={isDebt} onChange={setIsDebt} />
            <p className="ps-8 text-xs text-muted">{t('categories.isDebtHint')}</p>
          </div>
        </>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        {!cat.systemKey ? (
          cat.archived ? (
            <Button variant="ghost" onClick={() => restore.mutate(undefined)}>
              {t('categories.restore')}
            </Button>
          ) : (
            <Button variant="ghost" className="text-bad" onClick={() => remove.mutate(undefined)}>
              {t('common.delete')}
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!name.trim()} busy={save.isPending} data-testid="category-save">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

function RuleForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [field, setField] = useState<Rule['field']>('description');
  const [match, setMatch] = useState<Rule['match']>('contains');
  const [pattern, setPattern] = useState('');
  const [sign, setSign] = useState<Rule['sign']>('any');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const save = useApiMutation(() => post('/api/rules', { field, match, pattern: pattern.trim(), sign, categoryId }), { invalidate: [['rules']], onSuccess: onDone, successKey: 'ledger.saved' });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('categories.ruleField')} htmlFor="r-field">
          <Select id="r-field" value={field} onChange={(e) => setField(e.target.value as Rule['field'])}>
            <option value="description">{t('categories.fields.description')}</option>
            <option value="operation_type">{t('categories.fields.operation_type')}</option>
          </Select>
        </Field>
        <Field label={t('categories.ruleMatch')} htmlFor="r-match">
          <Select id="r-match" value={match} onChange={(e) => setMatch(e.target.value as Rule['match'])}>
            {MATCHES.map((m) => (
              <option key={m} value={m}>
                {t(`categories.matches.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label={t('categories.rulePattern')} htmlFor="r-pat">
        <Input id="r-pat" dir="auto" maxLength={100} value={pattern} onChange={(e) => setPattern(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('categories.ruleSign')} htmlFor="r-sign">
          <Select id="r-sign" value={sign} onChange={(e) => setSign(e.target.value as Rule['sign'])}>
            {SIGNS.map((s) => (
              <option key={s} value={s}>
                {t(`categories.signs.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('categories.ruleCategory')} htmlFor="r-cat">
          <CategorySelect id="r-cat" value={categoryId} onChange={setCategoryId} />
        </Field>
      </div>
      <Button disabled={!pattern.trim() || !categoryId} busy={save.isPending} onClick={() => save.mutate(undefined)}>
        {t('common.save')}
      </Button>
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const toast = useToast();
  const canWrite = useCanWrite();
  const cq = useCategories();
  const rq = useRules();
  const cmap = useCategoryMap();
  const [editing, setEditing] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const hasTx = useCategorySuggestions().data?.hasTransactions;
  const [addingRule, setAddingRule] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const delRule = useApiMutation((id: string) => del(`/api/rules/${id}`), { invalidate: [['rules']] });
  const apply = useApiMutation(() => post<{ applied: number }>('/api/rules/apply'), { invalidate: [...LEDGER_DEPENDENT], onSuccess: (r) => toast({ title: t('categories.applied', { count: r.applied }), tone: 'good' }) });
  const hideUnused = useApiMutation(() => post<{ hidden: number }>('/api/categories/hide-unused'), {
    invalidate: [['categories']],
    onSuccess: (r) => toast({ title: t('categories.hiddenToast', { count: r.hidden }), tone: 'good' }),
  });
  const all = cq.data?.categories ?? [];
  const hiddenCount = all.filter((c) => c.archived).length;
  const cats = all.filter((c) => showHidden || !c.archived);
  const rules = (rq.data?.rules ?? []).filter((r) => showSeed || r.source !== 'seed');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('categories.title')}
        actions={
          canWrite && (
            <Button onClick={() => setAdding(true)} data-testid="category-add">
              <Plus className="size-5" aria-hidden />
              {t('categories.add')}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hiddenCount > 0 ? <Checkbox label={t('categories.showHidden', { count: hiddenCount })} checked={showHidden} onChange={setShowHidden} testId="show-hidden" /> : <span />}
        {canWrite && hasTx && (
          <Button size="sm" variant="ghost" busy={hideUnused.isPending} onClick={() => setConfirmHide(true)} data-testid="hide-unused">
            {t('categories.hideUnused')}
          </Button>
        )}
      </div>
      {cq.isPending ? (
        <Spinner />
      ) : cq.error ? (
        <ErrorState error={cq.error} onRetry={() => void cq.refetch()} />
      ) : (
        KINDS.map((k) => (
          <Card key={k}>
            <CardTitle>{t(`categories.kinds.${k}`)}</CardTitle>
            <ul className="flex flex-wrap gap-2">
              {cats
                .filter((c) => c.kind === k)
                .map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => setEditing(c)}
                      className={cx('inline-flex min-h-11 items-center gap-1 rounded-xl border border-border px-3 text-sm', c.archived && 'opacity-50')}
                      data-testid="category-chip"
                    >
                      <span dir="auto">{c.name}</span>
                      {c.grp && <span className="text-xs text-muted">· {t(`categories.${c.grp}`)}</span>}
                      {c.systemKey && <Badge>{t('categories.system')}</Badge>}
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        ))
      )}
      <Card>
        <CardTitle
          action={
            canWrite && (
              <Button size="sm" variant="secondary" onClick={() => setAddingRule(true)}>
                <Plus className="size-4" aria-hidden />
                {t('categories.addRule')}
              </Button>
            )
          }
        >
          {t('categories.rules')}
        </CardTitle>
        <p className="mb-3 text-xs text-muted">{t('categories.ruleHelp')}</p>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Checkbox label={t('categories.showSeed')} checked={showSeed} onChange={setShowSeed} />
          {canWrite && (
            <Button size="sm" variant="ghost" busy={apply.isPending} onClick={() => apply.mutate(undefined)}>
              {t('categories.applyRules')}
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border" data-testid="rules-list">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0 text-muted">
                    {t(`categories.fields.${r.field}`)} {t(`categories.matches.${r.match}`)}
                  </span>
                  <bdi dir="auto" className="truncate font-medium">
                    {r.pattern}
                  </bdi>
                  <ArrowRight className="size-3 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
                  <span className="truncate">{cmap.get(r.categoryId)?.name}</span>
                </div>
                <div className="text-xs text-muted">
                  {t(`categories.sources.${r.source}`)} · {t(`categories.signs.${r.sign}`)}
                </div>
              </div>
              {canWrite && (
                <IconButton label={t('common.delete')} onClick={() => delRule.mutate(r.id)}>
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={t('common.edit')}>
        {editing && <CategoryForm cat={editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <AddCategorySheet open={adding} onOpenChange={setAdding} />
      <ConfirmSheet
        open={confirmHide}
        onOpenChange={setConfirmHide}
        title={t('categories.hideUnused')}
        body={t('categories.hideUnusedBody')}
        confirmLabel={t('categories.hideUnused')}
        danger={false}
        testId="hide-unused-confirm"
        onConfirm={() => hideUnused.mutateAsync(undefined).then(() => undefined)}
      />
      <Sheet open={addingRule} onOpenChange={setAddingRule} title={t('categories.addRule')}>
        {addingRule && <RuleForm onDone={() => setAddingRule(false)} />}
      </Sheet>
    </div>
  );
}
