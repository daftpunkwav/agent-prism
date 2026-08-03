import { Suspense } from "react";
import { ArenaClient } from "./ArenaClient";

export default function ArenaPage() {
  // useSearchParams 需要 Suspense boundary（Next.js App Router 要求）
  return (
    <Suspense fallback={<div className="arena-shell items-center justify-center" />}>
      <ArenaClient />
    </Suspense>
  );
}
