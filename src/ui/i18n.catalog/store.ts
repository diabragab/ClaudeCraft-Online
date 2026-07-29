// i18n source catalog - the public Store (Phase 4), a browsing + cart +
// checkout + order-history surface served at /store, built on top of the
// Phase 1-3 shop catalog/orders backend. English values only; translations
// live in src/ui/i18n.locales/<lang>.ts.
//
// Assembled into `en` by ./index.ts under the `store` namespace.

export const storeStrings = {
  brand: 'World of ClaudeCraft Store',

  nav: {
    home: 'Home',
    categories: 'Categories',
    products: 'Products',
    cart: 'Cart',
    orders: 'My Orders',
    signIn: 'Sign in',
    signedInAs: 'Signed in as {name}',
    signOut: 'Sign out',
  },

  common: {
    loading: 'Loading...',
    error: 'Something went wrong. Please try again.',
    retry: 'Retry',
    back: 'Back',
    addToCart: 'Add to cart',
    viewDetails: 'View details',
    quantityLabel: 'Quantity',
    remove: 'Remove',
    continueShopping: 'Continue shopping',
  },

  availability: {
    unlimited: 'In stock',
    inStock: 'In stock',
    lowStock: 'Low stock',
    outOfStock: 'Out of stock',
    unavailable: 'Unavailable',
  },

  priceClaudium: '{amount} Claudium',

  home: {
    heroTitle: 'Welcome to the Store',
    heroSubtitle: 'Browse categories, featured items, and new arrivals.',
    featuredTitle: 'Featured products',
    newTitle: 'New arrivals',
    categoriesTitle: 'Shop by category',
    noFeatured: 'No featured products right now.',
    noNew: 'No new products right now.',
    browseAll: 'Browse all products',
  },

  categories: {
    title: 'Categories',
    empty: 'No categories yet.',
  },

  products: {
    title: 'Products',
    searchPlaceholder: 'Search products',
    sortLabel: 'Sort by',
    sortNewest: 'Newest',
    sortName: 'Name',
    sortUpdated: 'Last updated',
    empty: 'No products match your search.',
    categoryNotFound: 'That category could not be found.',
  },

  product: {
    notFound: 'That product could not be found.',
    priceLabel: 'Price',
    currencyLabel: 'Pay with',
    skuLabel: 'SKU',
    categoryLabel: 'Category',
    addedToCart: 'Added to cart.',
    addFailed: 'Could not add this to your cart.',
  },

  cart: {
    title: 'Your cart',
    empty: 'Your cart is empty.',
    colProduct: 'Product',
    colPrice: 'Price',
    colQuantity: 'Quantity',
    colSubtotal: 'Subtotal',
    subtotalLabel: 'Subtotal',
    checkout: 'Proceed to checkout',
    currencyMismatchError: 'This item is priced in a different currency than what is already in your cart. Clear your cart first to switch currencies.',
  },

  checkout: {
    title: 'Checkout',
    reviewTitle: 'Order review',
    noteLabel: 'Note for this order (optional)',
    notePlaceholder: 'Anything the team should know about this order',
    totalLabel: 'Total',
    placeOrder: 'Place order',
    placingOrder: 'Placing order...',
    paymentNote: 'There is no payment gateway yet: your order is placed as pending, and our team will confirm payment and process it manually.',
    emptyCart: 'Your cart is empty. Add something before checking out.',
    orderFailed: 'Could not place this order.',
    outOfStockError: 'One or more items in your cart do not have enough stock available.',
    signInRequiredTitle: 'Sign in required',
    signInRequiredBody: 'Sign in on the World of ClaudeCraft home page to place an order.',
    signInLink: 'Go to sign in',
  },

  confirmation: {
    title: 'Order placed',
    body: 'Your order #{id} has been placed and is pending review.',
    viewOrder: 'View order',
  },

  orders: {
    title: 'My orders',
    empty: 'You have not placed any orders yet.',
    signInRequiredTitle: 'Sign in required',
    signInRequiredBody: 'Sign in on the World of ClaudeCraft home page to see your order history.',
    colId: 'Order',
    colStatus: 'Status',
    colTotal: 'Total',
    colDate: 'Placed',
  },

  orderDetail: {
    title: 'Order #{id}',
    notFound: 'That order could not be found.',
    summaryTitle: 'Summary',
    itemsTitle: 'Items',
    timelineTitle: 'Status history',
    colProduct: 'Product',
    colUnitPrice: 'Unit price',
    colQuantity: 'Quantity',
    colLineTotal: 'Line total',
    statusLabel: 'Status',
    placedLabel: 'Placed',
    updatedLabel: 'Updated',
    noteLabel: 'Note',
    timelineCreated: 'Order placed as {status}',
    timelineTransition: '{from} to {to}',
  },

  orderStatus: {
    pending: 'Pending',
    paid: 'Paid',
    fulfilled: 'Fulfilled',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  },

  notFound: {
    title: 'Page not found',
    body: 'That store page does not exist.',
    backHome: 'Back to the store home',
  },
};
