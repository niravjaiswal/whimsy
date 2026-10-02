import { lazy } from 'react';

/*
 * Everything except the landing page is split into its own chunk, so the first
 * paint only waits for the feed. The chunks are warmed in the background once
 * the browser is idle, so later navigations don't wait on them either.
 */
const loaders = {
  DealPage: () => import('./DealPage').then((m) => ({ default: m.DealPage })),
  AlertNew: () => import('./AlertNew').then((m) => ({ default: m.AlertNew })),
  AlertManage: () => import('./AlertManage').then((m) => ({ default: m.AlertManage })),
  MyAlerts: () => import('./MyAlerts').then((m) => ({ default: m.MyAlerts })),
  Scanner: () => import('./Scanner').then((m) => ({ default: m.Scanner })),
  SignIn: () => import('./SignIn').then((m) => ({ default: m.SignIn })),
  Account: () => import('./Account').then((m) => ({ default: m.Account })),
  ConfirmEmail: () => import('./ConfirmEmail').then((m) => ({ default: m.ConfirmEmail })),
};

export const DealPage = lazy(loaders.DealPage);
export const AlertNew = lazy(loaders.AlertNew);
export const AlertManage = lazy(loaders.AlertManage);
export const MyAlerts = lazy(loaders.MyAlerts);
export const Scanner = lazy(loaders.Scanner);
export const SignIn = lazy(loaders.SignIn);
export const Account = lazy(loaders.Account);
export const ConfirmEmail = lazy(loaders.ConfirmEmail);

let preloaded = false;
export function preloadPages() {
  if (preloaded) return;
  preloaded = true;
  const run = () => Object.values(loaders).forEach((load) => void load().catch(() => {}));
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}
