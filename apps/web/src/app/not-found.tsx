'use client';

import { TriangleAlert } from 'lucide-react';
import styles from './not-found.module.css';

export default function NotFound() {
  function goBack() {
    const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    if (navigation?.canGoBack ?? window.history.length > 1) {
      window.history.back();
    } else {
      window.location.assign('/');
    }
  }

  return (
    <main className={styles.page} aria-labelledby="not-found-title">
      <div className={styles.content}>
        <TriangleAlert className={styles.icon} aria-hidden="true" strokeWidth={2} />
        <h1 id="not-found-title" className={styles.title}>This page couldn’t load</h1>
        <p className={styles.description}>Reload to try again, or go back.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.reload} onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className={styles.back} onClick={goBack}>Back</button>
        </div>
      </div>
    </main>
  );
}
