import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { NotFound, Placeholder } from './features/common/Placeholder';
import { SessionGate } from './features/auth/SessionGate';
import { InvitePage, RecoverPage, SetupPage, SignInPage } from './features/auth/pages';

export const router = createBrowserRouter([
  { path: '/signin', element: <SignInPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/invite', element: <InvitePage /> },
  { path: '/recover', element: <RecoverPage /> },
  {
    element: <SessionGate />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Placeholder titleKey="nav.overview" /> },
          { path: 'transactions', lazy: () => import('./features/ledger/page') },
          { path: 'budget', element: <Placeholder titleKey="nav.budget" /> },
          { path: 'upcoming', element: <Placeholder titleKey="nav.upcoming" /> },
          { path: 'more', lazy: () => import('./features/more/page') },
          { path: 'forecast', element: <Placeholder titleKey="nav.forecast" /> },
          { path: 'recurring', element: <Placeholder titleKey="nav.recurring" /> },
          { path: 'accounts', lazy: () => import('./features/accounts/page') },
          { path: 'categories', lazy: () => import('./features/categories/page') },
          { path: 'goals', element: <Placeholder titleKey="nav.goals" /> },
          { path: 'trends', element: <Placeholder titleKey="nav.trends" /> },
          { path: 'review', element: <Placeholder titleKey="nav.review" /> },
          { path: 'import', element: <Placeholder titleKey="nav.import" /> },
          { path: 'household', lazy: () => import('./features/household/page') },
          { path: 'admin', lazy: () => import('./features/admin/page') },
          { path: 'settings', lazy: () => import('./features/settings/page') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
