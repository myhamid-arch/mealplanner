import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../../../components/plan/common";
import { SignedOut } from "../../../components/plan/signed-out";
import { RecipeLibraryScreen } from "../../../components/recipe/recipe-library";

export const metadata: Metadata = { title: "Recipes" };
export const dynamic = "force-dynamic";

/** Recipe library (UX-4; RecipeLibrary.dc.html). Filters are in the query string. */
export default function RecipesPage() {
  return (
    <SignedOut what="The recipe library">
      <Suspense fallback={<Loading label="Loading recipes" />}>
        <RecipeLibraryScreen />
      </Suspense>
    </SignedOut>
  );
}
