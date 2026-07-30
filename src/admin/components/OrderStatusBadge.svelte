<script lang="ts">
  import type { ShopOrderStatus } from '../types';
  import { t } from '../i18n';
  import Badge from './Badge.svelte';

  // Shared status pill for a shop order, used by both the Orders list and the
  // Order Details page so the color/label mapping cannot drift between them.
  let { status }: { status: ShopOrderStatus } = $props();

  const VARIANT: Record<ShopOrderStatus, 'warn' | 'default' | 'success' | 'neutral' | 'bad'> = {
    pending: 'warn',
    paid: 'default',
    fulfilled: 'success',
    cancelled: 'neutral',
    refunded: 'bad',
  };

  const LABEL_KEY: Record<ShopOrderStatus, string> = {
    pending: 'shopOrders.statusPending',
    paid: 'shopOrders.statusPaid',
    fulfilled: 'shopOrders.statusFulfilled',
    cancelled: 'shopOrders.statusCancelled',
    refunded: 'shopOrders.statusRefunded',
  };
</script>

<Badge variant={VARIANT[status]}>{t(LABEL_KEY[status])}</Badge>
