// Page registry: route id -> StorePage. app.ts dispatches through this so a
// new page is one entry here, never a branch inline in the orchestrator.

import { cartPage } from './cart_page';
import { categoriesPage } from './categories';
import { checkoutPage } from './checkout';
import { confirmationPage } from './confirmation';
import { homePage } from './home';
import { notFoundPage } from './not_found';
import { orderDetailPage } from './order_detail';
import { ordersPage } from './orders';
import { productDetailPage } from './product_detail';
import { productsPage } from './products';
import type { StorePage } from '../page';
import type { StoreRouteId } from '../routes';

export const PAGES: Record<StoreRouteId, StorePage> = {
  home: homePage,
  categories: categoriesPage,
  category: productsPage,
  products: productsPage,
  product: productDetailPage,
  cart: cartPage,
  checkout: checkoutPage,
  confirmation: confirmationPage,
  orders: ordersPage,
  order: orderDetailPage,
  notFound: notFoundPage,
};
