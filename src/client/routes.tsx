import { createBrowserRouter } from 'react-router';
import { Layout } from './components/Layout';
import { NotFound, Placeholder } from './features/common/Placeholder';
import { SessionGate } from './features/auth/SessionGate';

export const router = createBrowserRouter([
  {
    element: <SessionGate />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Placeholder titleKey="nav.overview" /> },
          { path: 'transactions', element: <Placeholder titleKey="nav.transactions" /> },
          { path: 'budget', element: <Placeholder titleKey="nav.budget" /> },
          { path: 'upcoming', element: <Placeholder titleKey="nav.upcoming" /> },
          { path: 'more', lazy: () => import('./features/more/page') },
          { path: 'forecast', element: <Placeholder titleKey="nav.forecast" /> },
          { path: 'recurring', element: <Placeholder titleKey="nav.recurring" /> },
          { path: 'accounts', element: <Placeholder titleKey="nav.accounts" /> },
          { path: 'goals', element: <Placeholder titleKey="nav.goals" /> },
          { path: 'trends', element: <Placeholder titleKey="nav.trends" /> },
          { path: 'review', element: <Placeholder titleKey="nav.review" /> },
          { path: 'import', element: <Placeholder titleKey="nav.import" /> },
          { path: 'household', element: <Placeholder titleKey="nav.household" /> },
          { path: 'settings', lazy: () => import('./features/settings/page') },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
