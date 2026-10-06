
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ProductView from './view';

// Product pages use /product?id=… so the site can be served as static files.
function ProductFromQuery() {
  return <ProductView id={useSearchParams().get('id')} />;
}

export default function ProductPage() {
  return (
    <Suspense>
      <ProductFromQuery />
    </Suspense>
  );
}
