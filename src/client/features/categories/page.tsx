import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { del, get, patch, post } from '../../api';
import { Badge, Button, Card, CardTitle, Checkbox, cx, ErrorState, Field, IconButton, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Sheet } from '../../components/Sheet';
import { useQuery } from '@tanstack/react-query';
import { AddCategorySheet } from '../../components/AddCategorySheet';
import { ConfirmSheet } from '../../components/Confirm';
import { CategorySelect } from '../../components/CategorySelect';
import { CategoryIcon, categoryLabel } from '../../components/CategoryIcon';
import { LookPicker } from '../../components/LookPicker';
import { colorSlotOf } from '../../../shared/categoryLook';
import { useToast } from '../../components/Toast';
import { useApiMutation } from '../../lib/mutate';
import { LEDGER_DEPENDENT, useCategories, useCategoryMap, useRules } from '../../lib/queries';
import { useCanWrite } from '../../lib/session';
import type { Category, Rule } from '../../../shared/schemas/ledger';

const KINDS: Category['kind'][] = ['expense', 'income', 'transfer'];
const MATCHES: Rule['match'][] = ['contains', 'equals', 'starts_with'];
const SIGNS: Rule['sign'][] = ['any', 'in', 'out'];
const MODES: Category['budgetMode'][] = ['monthly', 'general', 'occasional'];

function CategoryForm({ cat, onDone, onAddSub }: { cat: Category; onDone: () => void; onAddSub: (parent: Category) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const all = useCategories().data?.categories ?? [];
  const [name, setName] = useState(cat.name);
  const kind = cat.kind;
  const [grp, setGrp] = useState<'fixed' | 'variable'>(cat.grp ?? 'variable');
  const [isDebt, setIsDebt] = useState(cat.isDebt);
  const [mode, setMode] = useState<Category['budgetMode']>(cat.budgetMode);
  const [emoji, setEmoji] = useState<string | null>(cat.emoji);
  const [color, setColor] = useState<string>(colorSlotOf(cat));
  const [parentId, setParentId] = useState<string | null>(cat.parentId);
  const hasSubs = all.some((c) => c.parentId === cat.id && !c.archived);
  // A subcategory can go under an active top-level category of the same kind; one with subcategories stays top-level.
  const parents = all.filter((c) => c.kind === kind && !c.parentId && !c.systemKey && !c.archived && c.id !== cat.id);
  const isSub = !!parentId;
  const parent = parentId ? all.find((c) => c.id === parentId) : null;
  const save = useApiMutation(
    () =>
      patch(`/api/categories/${cat.id}`, {
        name: name.trim(),
        emoji: emoji ?? '',
        color,
        ...(cat.systemKey || hasSubs ? {} : { parentId }),
        ...(kind === 'expense' && !isSub ? { grp, isDebt, ...(cat.systemKey ? {} : { budgetMode: mode }) } : {}),
      }),
    {
      invalidate: [['categories'], ['budget'], ['dashboard'], ['health'], ['trends'], ...LEDGER_DEPENDENT],
      onSuccess: onDone,
      successKey: 'ledger.saved',
    },
  );
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
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <div className="flex items-center gap-3">
        <CategoryIcon cat={{ id: cat.id, color, emoji }} size="lg" />
        <Field label={t('categories.name')} htmlFor="cat-name">
          <Input id="cat-name" dir="auto" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} data-testid="category-name" />
        </Field>
      </div>
      <LookPicker emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
      {!cat.systemKey && !hasSubs && parents.length > 0 && (
        <Field label={t('categories.parent')} htmlFor="cat-parent" hint={t('categories.parentHint')}>
          <Select id="cat-parent" value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)} data-testid="category-parent">
            <option value="">{t('categories.topLevel')}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {categoryLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {kind === 'expense' && isSub && <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted" data-testid="category-follows">{t('categories.followsParent', { name: parent?.name ?? '' })}</p>}
      {kind === 'expense' && !isSub && (
        <>
          <Field label={t('categories.group')} htmlFor="cat-grp">
            <Select id="cat-grp" value={grp} onChange={(e) => setGrp(e.target.value as 'fixed' | 'variable')}>
              <option value="fixed">{t('categories.fixed')}</option>
              <option value="variable">{t('categories.variable')}</option>
            </Select>
          </Field>
          {!cat.systemKey && (
            <Field label={t('categories.mode.label')} htmlFor="cat-mode" hint={<span data-testid="category-mode-hint">{t(`categories.mode.${mode}Hint`)}</span>}>
              <Select id="cat-mode" value={mode} onChange={(e) => setMode(e.target.value as Category['budgetMode'])} data-testid="category-mode">
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`categories.mode.${m}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div>
            <Checkbox label={t('categories.isDebt')} checked={isDebt} onChange={setIsDebt} />
            <p className="ps-8 text-xs text-muted">{t('categories.isDebtHint')}</p>
          </div>
        </>
      )}
      {!cat.systemKey && !cat.parentId && !cat.archived && (
        <Button variant="secondary" onClick={() => onAddSub(cat)} data-testid="category-add-sub">
          <Plus className="size-4" aria-hidden />
          {t('categories.addSub')}
        </Button>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        {!cat.systemKey ? (
          cat.archived ? (
            <Button variant="ghost" busy={restore.isPending} onClick={() => restore.mutate(undefined)}>
              {t('categories.restore')}
            </Button>
          ) : (
            <Button variant="ghost" className="text-bad" busy={remove.isPending} onClick={() => remove.mutate(undefined)}>
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

/** One category row; `sub` rows sit indented under their parent. */
function CategoryRow({ c, sub, disabled, onClick }: { c: Category; sub?: boolean; disabled: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx('flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 text-start transition hover:bg-surface-2 active:bg-surface-2', sub && 'ps-10', c.archived && 'opacity-50')}
      data-testid="category-chip"
    >
      <CategoryIcon cat={c} size={sub ? 'sm' : 'md'} />
      <span dir="auto" className={cx('min-w-0 flex-1 truncate', sub ? 'text-sm' : 'font-medium')}>
        {c.name}
      </span>
      {!sub && c.grp && <span className="text-xs text-muted">{t(`categories.${c.grp}`)}</span>}
      {!sub && c.kind === 'expense' && c.budgetMode !== 'monthly' && <Badge tone="accent">{t(`categories.mode.${c.budgetMode}Short`)}</Badge>}
      {c.systemKey && <Badge>{t('categories.system')}</Badge>}
      <ChevronRight className="size-4 shrink-0 text-muted rtl:-scale-x-100" aria-hidden />
    </button>
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
  const [addingSub, setAddingSub] = useState<Category | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const hq = useQuery({ queryKey: ['categories', 'hide-unused'], queryFn: () => get<{ eligible: boolean; candidates: { id: string; name: string }[] }>('/api/categories/hide-unused'), enabled: canWrite });
  const candidates = hq.data?.candidates ?? [];
  const [addingRule, setAddingRule] = useState(false);
  const [showSeed, setShowSeed] = useState(false);
  const delRule = useApiMutation((id: string) => del(`/api/rules/${id}`), { invalidate: [['rules']] });
  const apply = useApiMutation(() => post<{ applied: number }>('/api/rules/apply'), { invalidate: [...LEDGER_DEPENDENT], onSuccess: (r) => toast({ title: t('categories.applied', { count: r.applied }), tone: 'good' }) });
  const hideUnused = useApiMutation((ids: string[]) => post<{ hidden: number }>('/api/categories/hide-unused', { ids }), {
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
            <Button onClick={() => setAdding(true)} data-testid="category-add" data-tour="category-add">
              <Plus className="size-5" aria-hidden />
              {t('categories.add')}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {hiddenCount > 0 ? <Checkbox label={t('categories.showHidden', { count: hiddenCount })} checked={showHidden} onChange={setShowHidden} testId="show-hidden" /> : <span />}
        {canWrite && candidates.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            busy={hideUnused.isPending}
            onClick={() => {
              setKeep(new Set());
              setConfirmHide(true);
            }}
            data-testid="hide-unused"
            data-tour="hide-unused"
          >
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
            <ul className="flex flex-col">
              {cats
                .filter((c) => c.kind === k && (!c.parentId || !cats.some((p) => p.id === c.parentId)))
                .map((c) => (
                  <li key={c.id}>
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <CategoryRow c={c} disabled={!canWrite} onClick={() => setEditing(c)} />
                      </div>
                      {/* one tap to a new subcategory of this one */}
                      {canWrite && !c.systemKey && !c.archived && (
                        <IconButton label={t('categories.addSubTo', { name: c.name })} onClick={() => setAddingSub(c)} className="text-accent" data-testid="category-row-add-sub">
                          <Plus className="size-5" aria-hidden />
                        </IconButton>
                      )}
                    </div>
                    {cats.some((s) => s.parentId === c.id) && (
                      <ul data-testid="category-subs">
                        {cats
                          .filter((s) => s.parentId === c.id)
                          .map((s) => (
                            <li key={s.id}>
                              <CategoryRow c={s} sub disabled={!canWrite} onClick={() => setEditing(s)} />
                            </li>
                          ))}
                      </ul>
                    )}
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
                  <span className="truncate">{categoryLabel(cmap.get(r.categoryId))}</span>
                </div>
                <div className="text-xs text-muted">
                  {t(`categories.sources.${r.source}`)} · {t(`categories.signs.${r.sign}`)}
                </div>
              </div>
              {canWrite && (
                <IconButton label={t('common.delete')} disabled={delRule.isPendingWith((v) => v === r.id)} onClick={() => delRule.mutate(r.id)}>
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={t('common.edit')}>
        {editing && (
          <CategoryForm
            key={editing.id}
            cat={editing}
            onDone={() => setEditing(null)}
            onAddSub={(p) => {
              setEditing(null);
              setAddingSub(p);
            }}
          />
        )}
      </Sheet>
      <AddCategorySheet open={adding} onOpenChange={setAdding} />
      {addingSub && <AddCategorySheet open onOpenChange={(o) => !o && setAddingSub(null)} parent={addingSub} />}
      <ConfirmSheet
        open={confirmHide}
        onOpenChange={setConfirmHide}
        title={t('categories.hideUnused')}
        body={
          <>
            <p className="mb-2">{t('categories.hideUnusedBody')}</p>
            <ul data-testid="hide-unused-list">
              {candidates.map((c) => (
                <li key={c.id}>
                  <Checkbox label={<bdi>{c.name}</bdi>} checked={!keep.has(c.id)} onChange={(v) => setKeep((k) => { const n = new Set(k); if (v) n.delete(c.id); else n.add(c.id); return n; })} />
                </li>
              ))}
            </ul>
          </>
        }
        confirmLabel={t('categories.hideUnused')}
        danger={false}
        testId="hide-unused-confirm"
        onConfirm={async () => {
          const ids = candidates.filter((c) => !keep.has(c.id)).map((c) => c.id);
          if (ids.length) await hideUnused.mutateAsync(ids);
        }}
      />
      <Sheet open={addingRule} onOpenChange={setAddingRule} title={t('categories.addRule')}>
        {addingRule && <RuleForm onDone={() => setAddingRule(false)} />}
      </Sheet>
    </div>
  );
}
