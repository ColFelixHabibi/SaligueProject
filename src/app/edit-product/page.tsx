
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import EditProductView from './view';

// Edit pages use /edit-product?id=… so the site can be served as static files.
function EditFromQuery() {
  return <EditProductView id={useSearchParams().get('id')} />;
}

export default function EditProductPage() {
  return (
    <Suspense>
      <EditFromQuery />
    </Suspense>
  );
}
