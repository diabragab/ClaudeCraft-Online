// Page registry: route id -> StorePage. app.ts dispatches through this so a
// new page is one entry here, never a branch inline in the orchestrator.

import type { StorePage } from '../page';
import type { StoreRouteId } from '../routes';
import { cartPage } from './cart_page';
import { categoriesPage } from './categories';
import { checkoutPage } from './checkout';
import { confirmationPage } from './confirmation';
import { homePage } from './home';
import { notFoundPage } from './not_found';
import { orderDetailPage } from './order_detail';
import { ordersPage } from './orders';
import { packageConfirmationPage } from './package_confirmation';
import { packagesPage } from './packages';
import { productDetailPage } from './product_detail';
import { productsPage } from './products';

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
  packages: packagesPage,
  packageConfirmation: packageConfirmationPage,
  notFound: notFoundPage,
};
