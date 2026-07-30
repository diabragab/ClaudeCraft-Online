<script lang="ts">
  import type { ClaudiumPurchaseStatus } from '../types';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';

  // Shared status pill for a Claudium Package purchase (Phase 8), used by
  // the payment history / audit log page.
  let { status }: { status: ClaudiumPurchaseStatus } = $props();

  const VARIANT: Record<ClaudiumPurchaseStatus, 'warn' | 'default' | 'success' | 'neutral' | 'bad'> = {
    pending: 'warn',
    paid: 'success',
    failed: 'bad',
    expired: 'neutral',
    refunded: 'bad',
  };

  const LABEL_KEY: Record<ClaudiumPurchaseStatus, string> = {
    pending: 'claudiumPurchases.statusPending',
    paid: 'claudiumPurchases.statusPaid',
    failed: 'claudiumPurchases.statusFailed',
    expired: 'claudiumPurchases.statusExpired',
    refunded: 'claudiumPurchases.statusRefunded',
  };
</script>

<Badge variant={VARIANT[status]}>{t(LABEL_KEY[status])}</Badge>
